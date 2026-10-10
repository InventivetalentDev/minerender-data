# minerender-data

Versioned Minecraft registry facts and reviewed rendering data for MineRender. `main` contains extractors, validation, and source mappings. Each Minecraft version has a data-only branch, following [minecraft-entity-models](https://github.com/InventivetalentDev/minecraft-entity-models).

Initial verified versions: **1.21.5** and **1.21.11**. Data is extracted independently from each version's client JAR. Unsupported versions never borrow another version's output.

## Extract

Use Node.js 22.12+ and a JDK compatible with the selected Minecraft version. Both initial versions require Java 21+. Set `JAVA_HOME` to select a JDK. No Node dependencies need installing.

```sh
node --test
node tools/extract.js --version 1.21.11 --output out/1.21.11
node tools/validate.js --input out/1.21.11 --version 1.21.11
```

The output directory must not exist. Downloads go to `.cache/minerender-data`; use `--cache DIR` to change it or `--offline` to require cached downloads. Mojang metadata, client, mappings, libraries, and the pinned AutoRenamingTool are checked against SHA-1 hashes. Extraction validates native item-stack values and potion color calculations before writing output. Add `--fixtures out/native-fixtures.json` to retain those behavioral samples separately from published data.

## Datasets

| File | Contents and source |
|---|---|
| `item-defaults.json` | Namespaced item IDs → namespaced stack-size, durability, and glint default components from the item registry. |
| `potion-colors.json` | Namespaced effect colors and potion effect lists from vanilla registries. |
| `block-states.json` | Every registered block's property defaults, types, and allowed values, including blocks with no properties. |
| `fluids.json` | Intrinsic water/lava associations and model visibility from vanilla block states. Waterlogged-state handling remains a consumer algorithm. |
| `dyes.json` | Dye IDs and texture, firework, and text colors from the vanilla dye enum. |
| `block-tints.json` | Reviewed MineRender preview rules, limited to registered blocks in an explicitly reviewed target version. These are rendering policy, not a full vanilla color-provider registry. |
| `legacy-blocks.json` | Numeric block ID/metadata mappings for source formats through 1.12.2, validated against the target version's blocks and property values. |

Registry IDs include their namespace. Block properties preserve MineRender's `default`, `type`, `valueType`, and `values` fields; enum values use vanilla's serialized names. `sources/provenance.json` pins reviewed inputs, supported target versions, attribution, and corrections. The legacy mapping derives from WorldEdit's mapping through MineRender; two wall entries explicitly translate old boolean sides to modern `none` values.

Each version includes `version.json` with its Mojang manifest entry, `_list.json`, and `manifest.json`. The manifest records schema version, Minecraft version/data version, client/mapping hashes, extractor Git revision and content hash, per-file SHA-256 hashes, and validation counts. An unsupported reviewed dataset appears in `unavailable` and has no data file. Consumers must check availability and use exact versions; an absent dataset is not an empty registry.

## Publish

Commit tooling before extracting publishable data. Publication verifies that the manifest matches the committed extractor, prepares a data-only version branch in a temporary Git worktree, and preserves existing version history.

```sh
node tools/publish.js --version 1.21.11 --input out/1.21.11
git push origin 1.21.11
```

Pass `--push` to the publish command to fetch and push the version branch itself. Pushes never force-replace remote history. Raw data is available at `https://raw.githubusercontent.com/InventivetalentDev/minerender-data/<version>/<file>`.

Scheduling is managed outside this repository. `node tools/versions.js` lists unpublished releases after the date in `versions.json`; it does not extract or publish data. Run the extraction, validation, and publication commands from your own scheduler. Changed game APIs fail extraction until the extractor is adapted; reviewed rules require a matching target profile before they are published.

## Migration scope

MineRender consumer migration is separate. The data replaces the bundled item defaults, potion colors, default block states, block tints, fluid associations, and legacy mappings; glint defaults are included with item components. Entity geometry/animations stay in `minecraft-entity-models`. Biome definitions and banner-pattern registries already exist in vanilla assets. Unused legacy geometry, build configuration, and test fixtures are not runtime datasets.

The item and potion extractors previously used as temporary scripts are incorporated in `tools/Extract.java`; their native checks run during every extraction. The downloader/runtime follows the entity-model tooling without depending on a sibling checkout. Further renderer facts, such as special-item texture tables, can be added with their own provenance and validation.
