import com.google.gson.GsonBuilder;
import java.lang.reflect.Method;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;
import net.minecraft.SharedConstants;
import net.minecraft.core.component.DataComponents;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.server.Bootstrap;
import net.minecraft.world.effect.MobEffectInstance;
import net.minecraft.world.item.DyeColor;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.alchemy.PotionContents;
import net.minecraft.world.level.block.LiquidBlock;
import net.minecraft.world.level.block.RenderShape;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.level.block.state.properties.BooleanProperty;
import net.minecraft.world.level.block.state.properties.EnumProperty;
import net.minecraft.world.level.block.state.properties.IntegerProperty;
import net.minecraft.world.level.block.state.properties.Property;
import net.minecraft.world.level.material.Fluids;

/** Extracts facts from the bootstrapped vanilla registries in the supplied client JAR. */
public class Extract {
    public static void main(String[] args) throws Exception {
        if (args.length < 1 || args.length > 2) {
            throw new IllegalArgumentException("Usage: Extract <data.json> [fixtures.json]");
        }
        SharedConstants.tryDetectVersion();
        Bootstrap.bootStrap();
        Object version = SharedConstants.getCurrentVersion();
        String minecraftVersion = (String) accessor(version, "name", "getName");
        Object dataVersion = accessor(version, "dataVersion", "getDataVersion");
        int dataVersionNumber = (Integer) accessor(dataVersion, "version", "getVersion");
        boolean fixtures = args.length == 2;

        var items = new TreeMap<String, Object>();
        var itemFixtures = new TreeMap<String, Object>();
        BuiltInRegistries.ITEM.forEach(item -> {
            String id = BuiltInRegistries.ITEM.getKey(item).toString();
            var entry = new TreeMap<String, Object>();
            var components = item.components();
            entry.put("minecraft:max_stack_size", components.get(DataComponents.MAX_STACK_SIZE));
            if (components.has(DataComponents.MAX_DAMAGE)) entry.put("minecraft:max_damage", components.get(DataComponents.MAX_DAMAGE));
            if (components.has(DataComponents.DAMAGE)) entry.put("minecraft:damage", components.get(DataComponents.DAMAGE));
            if (components.has(DataComponents.ENCHANTMENT_GLINT_OVERRIDE)) {
                entry.put("minecraft:enchantment_glint_override", components.get(DataComponents.ENCHANTMENT_GLINT_OVERRIDE));
            }
            items.put(id, entry);
            if (fixtures) {
                var samples = new ArrayList<Object>();
                ItemStack clean = item.getDefaultInstance();
                for (int count : new int[] {1, 8, 16, 32, 64}) {
                    var stack = clean.copy();
                    stack.setCount(count);
                    samples.add(itemSample(stack));
                }
                if (clean.getMaxDamage() > 0) {
                    for (int damage : new int[] {clean.getMaxDamage() / 2, clean.getMaxDamage()}) {
                        var stack = clean.copy();
                        stack.setDamageValue(damage);
                        samples.add(itemSample(stack));
                    }
                }
                itemFixtures.put(id, samples);
            }
        });

        var effects = new TreeMap<String, Integer>();
        BuiltInRegistries.MOB_EFFECT.forEach(effect ->
            effects.put(BuiltInRegistries.MOB_EFFECT.getKey(effect).toString(), effect.getColor() & 0xffffff));
        var potions = new TreeMap<String, Object>();
        var potionFixtures = new TreeMap<String, Object>();
        BuiltInRegistries.POTION.forEach(potion -> {
            String id = BuiltInRegistries.POTION.getKey(potion).toString();
            var entries = new ArrayList<Object>();
            for (var effect : potion.getEffects()) {
                if (!effect.isVisible()) throw new IllegalStateException("Invisible built-in potion effect: " + id);
                entries.add(new TreeMap<>(Map.of("id", effectId(effect), "amplifier", effect.getAmplifier())));
            }
            potions.put(id, entries);
            if (fixtures) potionFixtures.put(id, potionColor(potion.getEffects()));
        });

        var blocks = new TreeMap<String, Object>();
        var fluids = new TreeMap<String, Object>();
        BuiltInRegistries.BLOCK.forEach(block -> {
            String id = BuiltInRegistries.BLOCK.getKey(block).toString();
            BlockState state = block.defaultBlockState();
            var properties = new TreeMap<String, Object>();
            for (var property : state.getProperties()) properties.put(property.getName(), propertyData(state, property));
            blocks.put(id, properties);

            // Waterlogged blocks are handled by their state property, not an intrinsic fluid rule.
            if (properties.containsKey("waterlogged")) return;
            var fluid = state.getFluidState();
            if (fluid.isEmpty()) return;
            String kind;
            if (fluid.is(Fluids.WATER) || fluid.is(Fluids.FLOWING_WATER)) kind = "water";
            else if (fluid.is(Fluids.LAVA) || fluid.is(Fluids.FLOWING_LAVA)) kind = "lava";
            else throw new IllegalStateException("Unsupported intrinsic fluid in " + id);
            var rule = new LinkedHashMap<String, Object>();
            rule.put("kind", kind);
            if (block instanceof LiquidBlock) {
                if (!state.hasProperty(LiquidBlock.LEVEL)) throw new IllegalStateException("Missing fluid level in " + id);
                rule.put("levelProperty", LiquidBlock.LEVEL.getName());
            }
            rule.put("renderModel", state.getRenderShape() == RenderShape.MODEL);
            fluids.put(id, rule);
        });

        var dyes = new TreeMap<String, Object>();
        for (var dye : DyeColor.values()) {
            var entry = new LinkedHashMap<String, Object>();
            entry.put("id", dye.getId());
            entry.put("textureDiffuseColor", dye.getTextureDiffuseColor() & 0xffffff);
            entry.put("fireworkColor", dye.getFireworkColor() & 0xffffff);
            entry.put("textColor", dye.getTextColor() & 0xffffff);
            dyes.put(dye.getName(), entry);
        }
        var counts = new TreeMap<String, Integer>();
        counts.put("items", items.size());
        counts.put("effects", effects.size());
        counts.put("potions", potions.size());
        counts.put("blocks", blocks.size());
        counts.put("fluids", fluids.size());
        counts.put("dyes", dyes.size());
        var metadata = new LinkedHashMap<String, Object>();
        metadata.put("minecraftVersion", minecraftVersion);
        metadata.put("dataVersion", dataVersionNumber);
        metadata.put("counts", counts);
        var data = new LinkedHashMap<String, Object>();
        data.put("metadata", metadata);
        data.put("itemDefaults", items);
        data.put("potionColors", new TreeMap<>(Map.of("effects", effects, "potions", potions)));
        data.put("blockStates", blocks);
        data.put("fluids", fluids);
        data.put("dyes", dyes);
        write(Path.of(args[0]), data);
        if (fixtures) {
            var fixture = new LinkedHashMap<String, Object>();
            fixture.put("minecraftVersion", minecraftVersion);
            fixture.put("items", itemFixtures);
            fixture.put("potions", potionFixtures);
            fixture.put("effectMixtures", effectMixtures());
            write(Path.of(args[1]), fixture);
        }
        System.out.println("Extracted Minecraft " + minecraftVersion + ": " + counts);
    }

    private static <T extends Comparable<T>> Map<String, Object> propertyData(BlockState state, Property<T> property) {
        String type;
        String valueType;
        if (property instanceof BooleanProperty) type = valueType = "boolean";
        else if (property instanceof IntegerProperty) type = valueType = "int";
        else if (property instanceof EnumProperty) {
            type = "enum";
            valueType = property.getValueClass().getSimpleName();
        } else throw new IllegalStateException("Unsupported property type: " + property.getClass().getName());
        var values = new ArrayList<Object>();
        for (T value : property.getPossibleValues()) values.add(propertyValue(property, value));
        var entry = new LinkedHashMap<String, Object>();
        entry.put("default", propertyValue(property, state.getValue(property)));
        entry.put("type", type);
        entry.put("valueType", valueType);
        entry.put("values", values);
        return entry;
    }

    private static <T extends Comparable<T>> Object propertyValue(Property<T> property, T value) {
        return value instanceof Boolean || value instanceof Integer ? value : property.getName(value);
    }

    private static Map<String, Object> itemSample(ItemStack stack) {
        var result = new LinkedHashMap<String, Object>();
        result.put("count", stack.getCount());
        result.put("maxStackSize", stack.getMaxStackSize());
        result.put("maxDamage", stack.getMaxDamage());
        result.put("damage", stack.getDamageValue());
        result.put("damageable", stack.isDamageableItem());
        result.put("barVisible", stack.isBarVisible());
        result.put("barWidth", stack.getBarWidth());
        result.put("barColor", stack.getBarColor() & 0xffffff);
        return result;
    }

    private static String effectId(MobEffectInstance effect) {
        return BuiltInRegistries.MOB_EFFECT.getKey(effect.getEffect().value()).toString();
    }

    private static Integer potionColor(Iterable<MobEffectInstance> effects) {
        var color = PotionContents.getColorOptional(effects);
        return color.isPresent() ? color.getAsInt() & 0xffffff : null;
    }

    private static List<Object> effectMixtures() {
        var effects = BuiltInRegistries.MOB_EFFECT.stream().sorted((a, b) ->
            BuiltInRegistries.MOB_EFFECT.getKey(a).toString().compareTo(BuiltInRegistries.MOB_EFFECT.getKey(b).toString())).toList();
        var mixtures = new ArrayList<Object>();
        for (int i = 0; i < effects.size(); i++) {
            for (int amplifier : new int[] {0, 1, 255}) {
                for (boolean visible : new boolean[] {false, true}) {
                    var instances = List.of(
                        new MobEffectInstance(BuiltInRegistries.MOB_EFFECT.wrapAsHolder(effects.get(i)), 100, amplifier, false, visible),
                        new MobEffectInstance(BuiltInRegistries.MOB_EFFECT.wrapAsHolder(effects.get((i + 1) % effects.size())), 100, 1));
                    var values = new ArrayList<Object>();
                    for (var effect : instances) {
                        values.add(new TreeMap<>(Map.of("id", effectId(effect), "amplifier", effect.getAmplifier(), "show_particles", effect.isVisible())));
                    }
                    var sample = new LinkedHashMap<String, Object>();
                    sample.put("effects", values);
                    sample.put("color", potionColor(instances));
                    mixtures.add(sample);
                }
            }
        }
        return mixtures;
    }

    private static Object accessor(Object value, String current, String previous) throws Exception {
        Method method;
        try {
            method = value.getClass().getMethod(current);
        } catch (NoSuchMethodException missing) {
            method = value.getClass().getMethod(previous);
        }
        return method.invoke(value);
    }

    private static void write(Path path, Object data) throws Exception {
        Files.writeString(path, new GsonBuilder().setPrettyPrinting().serializeNulls().disableHtmlEscaping().create().toJson(data) + "\n");
    }
}
