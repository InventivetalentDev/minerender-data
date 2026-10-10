# minerender-data

Versioned Minecraft registry facts and reviewed rendering data for MineRender. `main` documents the datasets. Extraction, validation, source mappings, and publishing tools live in [minecraft-extractors](https://github.com/InventivetalentDev/minecraft-extractors). Each Minecraft version has a data-only branch, following [minecraft-entity-models](https://github.com/InventivetalentDev/minecraft-entity-models).

Initial verified versions: **1.21.5** and **1.21.11**. Data is extracted independently from each version's client JAR. Unsupported versions never borrow another version's output.

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

Registry IDs include their namespace. Block properties preserve MineRender's `default`, `type`, `valueType`, and `values` fields; enum values use vanilla's serialized names. [Source provenance](https://github.com/InventivetalentDev/minecraft-extractors/blob/main/extractors/minerender-data/sources/provenance.json) pins reviewed inputs, supported target versions, attribution, and corrections. The legacy mapping derives from WorldEdit's mapping through MineRender; two wall entries explicitly translate old boolean sides to modern `none` values.

Each version includes `version.json` with its Mojang manifest entry, `_list.json`, and `manifest.json`. The manifest records schema version, Minecraft version/data version, client/mapping hashes, extractor repository (`extractor.repository`), Git revision and content hash, per-file SHA-256 hashes, and validation counts. An unsupported reviewed dataset appears in `unavailable` and has no data file. Consumers must check availability and use exact versions; an absent dataset is not an empty registry.

## Extraction and publication

Use [minecraft-extractors](https://github.com/InventivetalentDev/minecraft-extractors) to extract, validate, and publish this dataset. It shares Minecraft downloads and runtime preparation with the entity-model extractor. Extraction checks source hashes, native item-stack values, and potion color calculations. Changed game APIs require an extractor update; reviewed rules require a matching target profile before they are published.

Publication preserves each version branch's history. Raw data is available at `https://raw.githubusercontent.com/InventivetalentDev/minerender-data/<version>/<file>`.

## Migration scope

MineRender consumer migration is separate. The data replaces the bundled item defaults, potion colors, default block states, block tints, fluid associations, and legacy mappings; glint defaults are included with item components. Entity geometry/animations stay in `minecraft-entity-models`. Biome definitions and banner-pattern registries already exist in vanilla assets. Unused legacy geometry, build configuration, and test fixtures are not runtime datasets.
