# Personal weapons and the arc thrower

`weapon_slash`, `weapon_pierce`, and `weapon_blunt` are three authored shape patterns. They are not inventory items. Each completed weapon is a separate `Armaments` record that owns one real catalog material ID, its measured material cost, mass, durability, damage, range, cadence, and attack mode. This keeps the 31 existing materials usable without creating 93 cloned item IDs or models. The 53 existing equipment results remain intact; the only additional equipment item is the `arc_thrower` component.

## Personal weapons

| Pattern | Attack mode | Range | Period | Damage factor | Material volume | Additional inputs |
| --- | --- | ---: | ---: | ---: | ---: | --- |
| `weapon_slash` | `strike` | 2.8 m | 0.55 s | 1.05 | 0.45 L | 0.2 L wood, 0.1 plant-fiber bundle |
| `weapon_pierce` | `pierce` | 4.4 m | 0.90 s | 0.90 | 0.30 L | 0.6 L wood, 0.2 plant-fiber bundle |
| `weapon_blunt` | `impact` | 2.5 m | 1.10 s | 1.10 | 0.75 L | 0.4 L wood, 0.15 plant-fiber bundle |

The chosen material's own `origin.recipe` supplies the required research and station. `quote()` checks those gates through `Progression.research` and `Progression._station()`; it does not accept a caller-selected station. Crafting atomically consumes the listed material and handle inputs, then reserves the recipe's energy multiplied by the pattern's `materialRecipeEnergyFraction` (0.1). Work lasts `max(baseCraftSeconds, materialRecipe.seconds × materialRecipeTimeFraction)` with a 25-second base and a 0.25 time fraction. A saved job retains its inputs, energy, station, research, output ID, and progress; losing station access pauses it.

For a material of tier T, hit damage is `gear_baseline_tT.stationaryDps × pattern.attackPeriodS × pattern.damageFactor`, so the pattern controls cadence and the modifier controls its stationary DPS. Maximum durability is `floor(material.cellHp × materialVolumeLiters × 1.8)`, with one point of wear per accepted weapon attack. Mass is the selected material's density times its consumed liters plus the mass of the extra handle inputs. These records do not change any comparison baseline's HP, defense, or damage fields.

The rack holds eight carried records plus one separately equipped `main_hand` record. Weapons never enter `Progression.inventory`. `loadout()` exposes the current damage, range, period, mode, and durability to the existing `damageHit()` path; `recordAttack()` only checks range/cooldown and applies wear. The attack packet is still applied once by runtime combat. `equippedAsset()` chooses one of the three SDK-authored hand models. Its working surface uses the same material palette as player machines; the handle and canonical geometry remain unchanged. The palette is visual and does not determine the stored material statistics.

`drainCarried()` removes and returns finished weapon records with their original IDs and current durability. An unfinished paid job remains in the saved Armaments ledger at its workbench. `recoverCarried(records)` restores exact records subject to rack capacity and returns overflow in `remaining`, so death recovery can be retried without duplicating a weapon.

## Explicit electrical weapon component

`arc_thrower` is one additional machine component with the explicit `projectile_attack` function. Its normal field-bench recipe consumes 4 scrap iron, 1 mana crystal ore, and 2 plant-fiber bundles; it requires the existing `power` research and takes 75 seconds, with no electrical input. The forge recipe and `power` research also have no electrical input. This breaks the otherwise circular requirement to already own 120 EU before making the component. The component itself holds at most 120 EU and each shot spends exactly 20 EU for 30 HP of piercing damage at up to 24 m, with a 1.25-second interval.

The current bootstrap is finite and uses existing hardware: fuel a `heat_engine` with two raw-timber units, connect its mechanical output to a `generator`, then connect the generator through a `battery` to the arc thrower. The engine yields mechanical EU from the paid thermal fuel, the generator applies its 0.75 conversion efficiency, and the battery stores/transfers only its declared capacity and throughput. The thrower does not drain its reserve while idle. Its firing API computes the muzzle from the mounted voxel and machine pose; callers cannot provide an origin. Out-of-range, cooldown, and empty-reserve attempts cost nothing. A valid shot spends one 20 EU claim and persists a retry receipt; the same claim cannot spend again or apply damage again. Shielded shots still consume that one paid shot.

The part geometry and muzzle anchor come from the shared voxel authoring SDK. The modeled coil and barrel do not add any behavior to motors or other components. `MachineSystem.fire()` runs only for a mounted `arc_thrower`; the runtime checks the returned ray origin against other colliders and routes one packet through `damageHit()`.
