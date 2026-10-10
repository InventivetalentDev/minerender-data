import { spawn } from 'node:child_process';
import { readFile, rename, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DEFAULT_CACHE, download, exists, loadVersion, sha1 } from './download.js';

const ART_VERSION = '2.0.18';
const ART_SHA1 = '59bd788e0a1bd339256711dee40015a62cdf3cd2';
const ART_URL = `https://maven.neoforged.net/releases/net/neoforged/AutoRenamingTool/${ART_VERSION}/AutoRenamingTool-${ART_VERSION}-all.jar`;
const NAMED_CLASSES = ['net/minecraft/SharedConstants.class', 'net/minecraft/server/Bootstrap.class',
  'net/minecraft/core/registries/BuiltInRegistries.class'];

export const javaTool = name => process.env.JAVA_HOME ? path.join(process.env.JAVA_HOME, 'bin', name) : name;

export function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { ...options, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', bytes => { output = (output + bytes).slice(-24000); });
    child.stderr.on('data', bytes => { output = (output + bytes).slice(-24000); });
    child.on('error', error => reject(new Error(`Cannot run ${command}: ${error.message}`)));
    child.on('close', code => code === 0 ? resolve(output) : reject(new Error(
      `${path.basename(command)} exited with code ${code}: ${output.trim()}`)));
  });
}

export function allowedLibrary(library) {
  let allowed = !library.rules;
  const osName = { darwin: 'osx', win32: 'windows', linux: 'linux' }[process.platform];
  const arch = { x64: 'x86_64', arm64: 'aarch64', ia32: 'x86' }[process.arch] || process.arch;
  for (const rule of library.rules || []) {
    if (rule.os?.name && rule.os.name !== osName) continue;
    if (rule.os?.arch && !new RegExp(`^(?:${rule.os.arch})$`).test(arch)) continue;
    if (rule.os?.version && !new RegExp(rule.os.version).test(os.release())) continue;
    if (rule.features && Object.values(rule.features).some(Boolean)) continue;
    allowed = rule.action === 'allow';
  }
  return allowed;
}

export async function prepareRuntime(version, { cache = DEFAULT_CACHE, offline = false } = {}) {
  cache = path.resolve(cache);
  const { entry, metadata, directory } = await loadVersion(version, cache, offline);
  const java = javaTool('java');
  const requiredJava = Math.max(17, metadata.javaVersion?.majorVersion || 17);
  const javaVersion = await run(java, ['-version']);
  const javaMajor = Number(javaVersion.match(/version "(\d+)/)?.[1]);
  if (!javaMajor || javaMajor < requiredJava) {
    throw new Error(`Minecraft ${version} requires Java ${requiredJava}+; set JAVA_HOME to a matching JDK`);
  }
  const client = metadata.downloads?.client;
  if (!client?.url || !/^[a-f0-9]{40}$/.test(client.sha1)) throw new Error(`Missing client download for Minecraft ${version}`);
  const clientJar = path.join(directory, `client-${client.sha1}.jar`);
  await download(client.url, clientJar, client.sha1, offline);
  const source = { client: { sha1: client.sha1, url: client.url } };
  const mappings = metadata.downloads.client_mappings;
  let jar = clientJar;
  if (!mappings) {
    const entries = new Set((await run(javaTool('jar'), ['tf', clientJar, ...NAMED_CLASSES])).trim().split(/\r?\n/));
    const missing = NAMED_CLASSES.filter(name => !entries.has(name));
    if (missing.length) throw new Error(`Minecraft ${version} has no mappings and is missing named classes: ${missing.join(', ')}`);
  }
  const libraries = [];
  const artifacts = [...new Map(metadata.libraries.filter(allowedLibrary)
    .map(library => library.downloads?.artifact).filter(Boolean).map(artifact => [artifact.sha1, artifact])).values()];
  for (let index = 0; index < artifacts.length; index += 6) {
    const results = await Promise.allSettled(artifacts.slice(index, index + 6).map(async artifact => {
      if (!/^[a-f0-9]{40}$/.test(artifact.sha1)) throw new Error(`Invalid library SHA-1: ${artifact.url}`);
      const file = path.join(cache, 'libraries', `${artifact.sha1}.jar`);
      await download(artifact.url, file, artifact.sha1, offline);
      return file;
    }));
    for (const result of results) {
      if (result.status === 'rejected') throw result.reason;
      libraries.push(result.value);
    }
  }
  if (mappings) {
    if (!mappings.url || !/^[a-f0-9]{40}$/.test(mappings.sha1)) throw new Error(`Invalid client mappings for Minecraft ${version}`);
    const mappingFile = path.join(directory, `mappings-${mappings.sha1}.txt`);
    const remapper = path.join(cache, `AutoRenamingTool-${ART_VERSION}-all.jar`);
    await download(mappings.url, mappingFile, mappings.sha1, offline);
    await download(ART_URL, remapper, ART_SHA1, offline);
    source.mappings = { sha1: mappings.sha1, url: mappings.url };
    source.remapper = { version: ART_VERSION, sha1: ART_SHA1 };
    const remapKey = sha1(`${client.sha1}:${mappings.sha1}:${ART_SHA1}`);
    jar = path.join(directory, `mapped-${remapKey}.jar`);
    const checksum = `${jar}.sha1`;
    if (await exists(jar) && await exists(checksum)) {
      if (sha1(await readFile(jar)) !== (await readFile(checksum, 'utf8')).trim()) throw new Error(`SHA-1 mismatch: ${jar}`);
    } else {
      if (offline) throw new Error(`Offline cache miss: ${jar}`);
      const temporary = `${jar}.${process.pid}.tmp.jar`;
      try {
        await run(java, ['-Xmx2G', '-jar', remapper, '--input', clientJar, '--output', temporary,
          '--map', mappingFile, '--reverse', '--ann-fix', '--record-fix', '--strip-sigs', '--threads', '2',
          '--log', path.join(directory, 'remap.log'), ...libraries.flatMap(file => ['--lib', file])]);
        await rename(temporary, jar);
        await writeFile(checksum, sha1(await readFile(jar)) + '\n');
      } finally {
        await rm(temporary, { force: true });
      }
    }
  }
  return { entry, metadata, jar, libraries, java, source };
}
