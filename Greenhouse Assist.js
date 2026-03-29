/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * Greenhouse Assist — Sensor-less Greenhouse Thermodynamic & Biology Engine
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Pure logic module for estimating internal greenhouse conditions using
 * Open-Meteo ambient data and first-principles thermodynamic modeling.
 *
 * Location Baseline: Nobleboro, Maine (44.08°N, 69.49°W)
 *   - USDA Zone 5b, maritime-continental transition
 *   - Average solar noon irradiance (clear): ~800-950 W/m² peak (Jun-Aug)
 *   - Annual frost-free window: ~May 1 – Oct 15 (~165 days)
 *
 * No DOM, no UI, no side-effects. Pure functions + data exports.
 *
 * Exported API:
 *   CROP_PROFILES          — Data dictionary of crop-specific thermal/RH envelopes
 *   calculateCropNeeds()   — Multi-crop compromise deadband calculator
 *   getGrowthStage()       — Canopy transpiration multiplier by Days After Planting
 *   calculateVPD()         — Vapor Pressure Deficit estimator (kPa)
 *   calculateWindDynamics()— Aerodynamic wind-structure interaction model
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 */


// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 1: CROP PROFILES — DATA DICTIONARY
// ═══════════════════════════════════════════════════════════════════════════════
//
// Each profile encodes the thermodynamic and phytopathological boundaries for
// a crop category grown under high-tunnel or greenhouse cover in Zone 5b.
//
// Temperature values in °F (field standard in the US Northeast).
// RH thresholds derived from peer-reviewed plant pathology literature:
//   - Botrytis cinerea sporulation onset: >85% RH sustained >4 hrs (Elad 1997)
//   - Downy mildew pressure: >92% RH + leaf wetness >6 hrs
//   - Powdery mildew suppression: RH 40-70% (Jarvis et al., 2002)
//
// DAY/NIGHT TEMPERATURE DIFFERENTIAL (DIF):
//   Plants universally benefit from cooler nighttime temperatures.
//   During the day, warmth drives photosynthesis and vegetative growth.
//   At night, cooler temps promote healthy respiration, reduce etiolation
//   (stretching), and allow the plant to conserve carbohydrate reserves.
//   A positive DIF (day warmer than night) produces compact, sturdy plants.
//   A zero or negative DIF produces weak, leggy growth.
//   Typical optimal DIF: 8–15°F (daytime high minus nighttime low).
//
// Fields per profile:
//   icon         — Visual emoji identifier for UI rendering
//   label        — Human-readable crop category name
//   minTemp      — Lower bound of OPTIMAL DAYTIME growth range (°F)
//   maxTemp      — Upper bound of OPTIMAL DAYTIME growth range (°F)
//   nightMinTemp — Lower bound of OPTIMAL NIGHTTIME growth range (°F)
//   nightMaxTemp — Upper bound of OPTIMAL NIGHTTIME growth range (°F)
//   botrytisRH   — Relative humidity threshold (%) at which Botrytis cinerea
//                  sporulation risk becomes significant for this crop family.
//                  Botrytis is the #1 enclosed-structure pathogen in Maine.
//                  Varies by crop due to canopy density and microclimate.
// ═══════════════════════════════════════════════════════════════════════════════

export const CROP_PROFILES = {

    // ─────────────────────────────────────────
    // SOLANACEAE — Tomatoes, Peppers, Eggplant
    // ─────────────────────────────────────────
    // Indeterminate tomatoes are the primary enclosed crop in Maine high-tunnels.
    // Dense, vertically-trellised canopy with massive leaf area index (LAI 3-5).
    // High transpiration rate makes humidity management the #1 challenge.
    // Botrytis specifically attacks pruning wounds and fruit stem scars.
    solanaceous: {
        icon: '🍅',
        label: 'Solanaceous (Tomatoes / Peppers)',
        minTemp: 70,        // Below 65°F: growth slows dramatically
                            // Below 55°F: chilling injury — pollen sterility, blossom drop
        maxTemp: 85,        // Above 85°F: lycopene synthesis halts, fruit sunscald risk
                            // Above 95°F: pollen desiccation, complete reproductive failure
        nightMinTemp: 60,   // Nighttime optimal low. Below 55°F: chilling injury risk.
                            // Cooler nights promote fruit ripening and sugar accumulation.
                            // DIF of 10–15°F drives compact, productive growth.
        nightMaxTemp: 68,   // Nights above 68°F cause excessive respiration, burning
                            // carbohydrate reserves. Above 75°F: pollen viability drops.
                            // Source: Bayer CropScience, NMSU greenhouse management
        botrytisRH: 85,     // Botrytis cinerea sporulation threshold for Solanaceae
                            // Dense canopy traps humid microclimates around fruit clusters.
                            // Pruning wounds provide direct infection courts.
                            // Gray mold is the #1 winter greenhouse pathogen in Maine.
                            // Source: Elad (1997), Jarvis et al. (2002)
    },

    // ──────────────────────────────────────────────
    // COLD-HARDY GREENS — Spinach, Kale, Lettuce
    // ──────────────────────────────────────────────
    // Maine's 4-season workhorse crops. Tolerate sub-freezing temps inside
    // unheated tunnels but are extremely susceptible to heat stress once solar
    // gain pushes past ~75°F — bolting becomes irreversible within 48-72 hrs.
    // Low canopy height means less transpiration but more surface moisture
    // retention on leaf rosettes → crown rot risk.
    coldHardyGreens: {
        icon: '🥬',
        label: 'Cold-Hardy Greens (Spinach / Kale)',
        minTemp: 35,        // Can tolerate down to 20°F for short periods
                            // Below 20°F: ice crystal damage in lettuce types
                            // Kale/spinach actually sweetens below 35°F (sugar antifreeze)
        maxTemp: 70,        // Above 72°F: bolting trigger activated
                            // Above 80°F: irreversible bolting within 2-3 days
                            // Lettuce becomes bitter above 75°F
        nightMinTemp: 28,   // Hardy greens tolerate freezing nights. Kale/spinach survive
                            // down to 20°F. Lettuce more tender — 28°F is the safe floor.
                            // Cold nights trigger sugar antifreeze (cryoprotection).
        nightMaxTemp: 55,   // Warm nights accelerate bolting vernalization.
                            // Keep below 55°F at night to maximize leaf quality.
                            // Source: Coleman (2009) The Winter Harvest Handbook
        botrytisRH: 80,     // LOWER threshold than solanaceous crops.
                            // Reason: rosette growth habit traps moisture at the crown.
                            // Sclerotinia sclerotiorum (White Mold) co-occurs at similar RH.
                            // Dense lettuce plantings are especially vulnerable.
                            // Sources: UMass Extension / PSU floriculture pathology
                            // Note: Bolton et al. (2006) covers Sclerotinia specifically.
    },

    // ────────────────────────────────────────────
    // CUCURBITS — Cucumbers, Melons, Squash
    // ────────────────────────────────────────────
    // Heat-loving tropicals. In Maine's short season, these crops NEED the
    // greenhouse effect. Venting strategy is inverted: we vent reluctantly
    // and only to manage extreme RH or temps above 95°F.
    // Massive, horizontal leaf surfaces with high transpiration rates.
    // Downy mildew inoculum arrives from southern states via storm fronts.
    cucurbits: {
        icon: '🥒',
        label: 'Cucurbits (Cucumbers / Melons)',
        minTemp: 75,        // Below 60°F: growth ceases
                            // Below 50°F: cold shock — vine collapse within 48 hrs
                            // NEVER expose to ambient air below 55°F
        maxTemp: 90,        // Above 95°F: pollen desiccation, fruit abortion
                            // Above 100°F: irreversible vine stress
        nightMinTemp: 60,   // Cucurbits are tropical — chilling injury at sustained <60°F.
                            // Below 50°F night temps cause vine collapse within 48 hrs.
                            // Keep nighttime above 60°F for reliable fruit set.
        nightMaxTemp: 70,   // Warm nights drive excessive vine growth at expense of fruit.
                            // Nights above 70°F waste carbohydrate reserves.
                            // Optimal DIF: 10–20°F for balanced vine/fruit development.
                            // Source: DryGair greenhouse climate management
        botrytisRH: 90,     // Higher tolerance than other crops because cucurbit
                            // leaf surfaces are waxy and less susceptible.
                            // However, Downy Mildew (Pseudoperonospora cubensis) becomes
                            // the dominant threat at 92% RH with 6+ hrs leaf wetness.
                            // Powdery Mildew paradoxically thrives at moderate RH (40-70%)
                            // with dry leaf surfaces — a different mechanism entirely.
                            // Source: CDM ipmPIPE monitoring network
    },

    // ────────────────────────────────────────────
    // ROOT VEGETABLES — Carrots, Beets, Radishes
    // ────────────────────────────────────────────
    // Root crops in tunnels are primarily a shoulder-season play in Maine.
    // They tolerate cold well but hate wet crowns. The underground storage
    // organs buffer against temperature swings, but foliage disease (Alternaria,
    // Cercospora) can devastate the canopy, reducing root sizing.
    // Relatively low maintenance under cover but moisture at the soil surface
    // creates a consistently humid microclimate at the crown zone.
    rootVeggies: {
        icon: '🥕',
        label: 'Root Vegetables (Carrots / Beets)',
        minTemp: 40,        // Below 40°F: growth effectively stops
                            // Below 28°F: soil freezing damages exposed root shoulders
                            // Carrots can overwinter if mulched, but beets cannot
        maxTemp: 75,        // Above 75°F: bolting risk in beets and radishes
                            // Above 80°F: carrot roots become woody and bitter
                            // Radishes split and become pithy above 78°F
        nightMinTemp: 35,   // Root crops are cold-tolerant. Carrots survive hard frosts
                            // if mulched. Beets less hardy — 35°F is a safe floor.
                            // Cool nights promote sugar storage in roots.
        nightMaxTemp: 60,   // Warm nights accelerate bolting in beets and radishes.
                            // Carrot roots develop better flavor with cool nights.
                            // Optimal DIF: 10–15°F for root quality.
                            // Source: Cornell Extension, CSU greenhouse management
        botrytisRH: 83,     // Moderate threshold. Root crop canopies are less dense
                            // than solanaceous but the soil-level humidity contribution
                            // creates persistent moisture at the crown junction.
                            // Alternaria dauci (carrot leaf blight) activates at similar
                            // RH levels but primarily needs leaf wetness duration.
                            // Sclerotinia risk is elevated in beet plantings at >83% RH.
                            // Source: Koike et al. (2007)
    }
};


// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 2: MULTI-CROP COMPROMISE DEADBAND CALCULATOR
// ═══════════════════════════════════════════════════════════════════════════════
//
// When a grower runs multiple crops in the same greenhouse (e.g., tomatoes and
// lettuce sharing a 30×96 high-tunnel), temperature management becomes a
// NEGOTIATION between competing thermal requirements.
//
// The "deadband" is the temperature range where ALL selected crops are within
// their optimal growth zone. If this range exists, it's the safe operating zone.
//
// If crops are incompatible (e.g., heat-loving cucurbits with cold-hardy greens),
// the deadband inverts: the coldest crop's max is BELOW the hottest crop's min.
// In this case, we flag the conflict and calculate a COMPROMISE average — the
// thermodynamic "least bad" midpoint where both crops experience equal deviation
// from their ideal conditions.
//
// Mathematical approach:
//   Safe Deadband:
//     deadband.min = MAX(all selected crops' minTemp)
//     deadband.max = MIN(all selected crops' maxTemp)
//     If deadband.min <= deadband.max → valid overlap exists
//
//   Compromise (when deadband.min > deadband.max):
//     compromiseMin = MEAN(all selected crops' minTemp)
//     compromiseMax = MEAN(all selected crops' maxTemp)
//     This splits the thermal stress equally across all crops.
//
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Calculates the safest overlapping temperature deadbands (day AND night)
 * for one or more crops sharing a single greenhouse structure.
 *
 * @param {string[]} selectedCropIdsArray — Array of crop profile keys
 *   from CROP_PROFILES. Must contain at least one valid key.
 *   Example: ['solanaceous', 'coldHardyGreens']
 *
 * @returns {object} Result object with the following shape:
 *   {
 *     crops: [{ id, icon, label, minTemp, maxTemp, nightMinTemp, nightMaxTemp, botrytisRH }],
 *     deadband: { min, max },              — Safest overlapping DAYTIME temp range (°F)
 *     nightDeadband: { min, max },         — Safest overlapping NIGHTTIME temp range (°F)
 *     conflict: boolean,                   — True if no natural daytime overlap exists
 *     nightConflict: boolean,              — True if no natural nighttime overlap exists
 *     compromiseDeadband: { min, max },    — Averaged compromise range (only if conflict)
 *     botrytisRH: number,                  — Most conservative (lowest) botrytis threshold
 *     warnings: string[],                  — Human-readable conflict descriptions
 *   }
 */
export function calculateCropNeeds(selectedCropIdsArray) {

    // ── Input Validation ──
    // Guard against empty or invalid crop selections.
    if (!Array.isArray(selectedCropIdsArray) || selectedCropIdsArray.length === 0) {
        throw new Error(
            'calculateCropNeeds() requires a non-empty array of crop IDs. ' +
            `Valid IDs: ${Object.keys(CROP_PROFILES).join(', ')}`
        );
    }

    // ── Resolve crop profiles ──
    // Look up each selected crop ID and extract the thermal/RH envelope.
    // Filter out any invalid keys and warn about them.
    const validCrops = [];
    const invalidIds = [];

    for (const id of selectedCropIdsArray) {
        const profile = CROP_PROFILES[id];
        if (profile) {
            validCrops.push({
                id,
                icon: profile.icon,
                label: profile.label,
                minTemp: profile.minTemp,
                maxTemp: profile.maxTemp,
                nightMinTemp: profile.nightMinTemp,
                nightMaxTemp: profile.nightMaxTemp,
                botrytisRH: profile.botrytisRH
            });
        } else {
            invalidIds.push(id);
        }
    }

    if (validCrops.length === 0) {
        throw new Error(
            `No valid crop IDs found in [${selectedCropIdsArray.join(', ')}]. ` +
            `Valid IDs: ${Object.keys(CROP_PROFILES).join(', ')}`
        );
    }

    // ── Calculate the natural overlap deadband ──
    //
    // The safe zone is where ALL crops are happy simultaneously:
    //   deadband.min = the HIGHEST minTemp among all crops (the warmest "cold floor")
    //   deadband.max = the LOWEST maxTemp among all crops (the coolest "heat ceiling")
    //
    // Visual example with 3 crops:
    //
    //   Crop A:    |=====40=============80====|
    //   Crop B:         |=====55=========75===|
    //   Crop C:    |===35================85=======|
    //                    ↑ overlap min    ↑ overlap max
    //              Safe deadband: 55°F – 75°F

    // ── Calculate DAYTIME overlap deadband ──
    const deadbandMin = Math.max(...validCrops.map(c => c.minTemp));
    const deadbandMax = Math.min(...validCrops.map(c => c.maxTemp));

    // ── Calculate NIGHTTIME overlap deadband ──
    // Same logic but using nightMinTemp / nightMaxTemp.
    // Cooler night temps promote healthy respiration and stem strength.
    const nightDeadbandMin = Math.max(...validCrops.map(c => c.nightMinTemp));
    const nightDeadbandMax = Math.min(...validCrops.map(c => c.nightMaxTemp));

    // ── Determine if conflicts exist ──
    const conflict = deadbandMin > deadbandMax;
    const nightConflict = nightDeadbandMin > nightDeadbandMax;

    // ── Build result ──
    const result = {
        crops: validCrops,
        deadband: {
            min: deadbandMin,
            max: deadbandMax
        },
        nightDeadband: {
            min: nightDeadbandMin,
            max: nightDeadbandMax
        },
        conflict,
        nightConflict,

        // The most conservative botrytis threshold protects ALL crops.
        botrytisRH: Math.min(...validCrops.map(c => c.botrytisRH)),

        warnings: []
    };

    // ── Handle invalid crop IDs ──
    if (invalidIds.length > 0) {
        result.warnings.push(
            `Skipped unknown crop ID(s): ${invalidIds.join(', ')}. ` +
            `Valid IDs: ${Object.keys(CROP_PROFILES).join(', ')}`
        );
    }

    // ── Calculate compromise deadband if in conflict ──
    if (conflict) {
        // When no natural overlap exists, the "Compromise Deadband" is the
        // arithmetic mean of all crops' min and max temps. This creates a
        // temperature zone where ALL crops experience roughly equal deviation
        // from their ideal conditions — the "least bad" operating point.
        //
        // This is NOT optimal for any crop, but it distributes thermal stress
        // evenly rather than sacrificing one crop entirely.

        const sumMin = validCrops.reduce((sum, c) => sum + c.minTemp, 0);
        const sumMax = validCrops.reduce((sum, c) => sum + c.maxTemp, 0);
        const count = validCrops.length;

        result.compromiseDeadband = {
            min: Math.round(sumMin / count),
            max: Math.round(sumMax / count)
        };

        // ── Generate human-readable conflict warnings ──
        // Identify the specific crops causing the conflict.
        // The conflict is between the crop with the highest minTemp and
        // the crop with the lowest maxTemp.

        const warmestFloor = validCrops.reduce(
            (max, c) => c.minTemp > max.minTemp ? c : max,
            validCrops[0]
        );
        const coolestCeiling = validCrops.reduce(
            (min, c) => c.maxTemp < min.maxTemp ? c : min,
            validCrops[0]
        );

        result.warnings.push(
            `⚠️ THERMAL CONFLICT: ${warmestFloor.icon} ${warmestFloor.label} needs ≥${warmestFloor.minTemp}°F, ` +
            `but ${coolestCeiling.icon} ${coolestCeiling.label} must stay ≤${coolestCeiling.maxTemp}°F. ` +
            `There is a ${deadbandMin - deadbandMax}°F gap with NO safe overlap.`
        );

        result.warnings.push(
            `🔀 COMPROMISE DEADBAND: Averaging all crops → ${result.compromiseDeadband.min}–${result.compromiseDeadband.max}°F. ` +
            `This is NOT optimal for any crop. Both sides will experience thermal stress. ` +
            `Consider separating incompatible crops into different structures.`
        );
    } else if (validCrops.length > 1) {
        // ── No conflict, but narrowed range notification ──
        // Let the grower know their combined deadband is tighter than
        // any single crop's range.

        const narrowing = (
            Math.max(...validCrops.map(c => c.maxTemp)) -
            Math.min(...validCrops.map(c => c.minTemp))
        ) - (deadbandMax - deadbandMin);

        if (narrowing > 0) {
            result.warnings.push(
                `✅ Safe overlap found: ${deadbandMin}–${deadbandMax}°F ` +
                `(${deadbandMax - deadbandMin}°F window). ` +
                `Multi-crop selection narrowed the operating range by ${narrowing}°F ` +
                `compared to the widest single-crop range.`
            );
        }
    }

    return result;
}


// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 3: CANOPY TRANSPIRATION — GROWTH STAGE MOISTURE MODEL
// ═══════════════════════════════════════════════════════════════════════════════
//
// Plant transpiration is the dominant humidity source inside an enclosed
// greenhouse. As crops grow, their Leaf Area Index (LAI) increases, and the
// volume of water transpired per day rises proportionally.
//
// This function models the relationship between Days After Planting (DAP) and
// the transpiration-driven humidity contribution to the enclosed environment.
//
// Growth stage model (generalized across crop families):
//
//   ┌─────────────────────────────────────────────────────────────┐
//   │  SEEDLING         │  VEGETATIVE       │  MATURE CANOPY     │
//   │  DAP 0–14         │  DAP 14–40        │  DAP 40+           │
//   │                   │                   │                    │
//   │  LAI: 0.3–0.8     │  LAI: 1.5–3.0     │  LAI: 3.0–6.0+    │
//   │  Transpiration:   │  Transpiration:    │  Transpiration:    │
//   │  ~0.1–0.3 L/plant │  ~0.5–1.0 L/plant │  ~1.0–3.0 L/plant │
//   │                   │                   │                    │
//   │  RH effect: +2%   │  RH effect: +6%   │  RH effect: +12%  │
//   └─────────────────────────────────────────────────────────────┘
//
// These multipliers represent the ADDITIONAL RH contribution above ambient,
// added to the enclosed volume by plant transpiration at each growth stage.
//
// Source:
//   - Allen et al. (1998) FAO Irrigation & Drainage Paper 56 (Kc curves)
//   - Stanghellini (1987) Transpiration of greenhouse crops
//   - Coleman (2009) The Winter Harvest Handbook — practical Maine tunnel data
//
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Determines the growth stage and transpiration multiplier for a crop based
 * on its planting date.
 *
 * @param {string} plantDateString — ISO 8601 date string (YYYY-MM-DD) or any
 *   format parseable by the Date constructor. Represents the date the crop
 *   was transplanted or direct-seeded into the greenhouse.
 *
 * @returns {object} Growth stage analysis:
 *   {
 *     plantDate: string,         — Echo of the input date (ISO format)
 *     today: string,             — Current date (ISO format)
 *     daysAfterPlanting: number, — DAP (integer, 0+)
 *     stage: string,             — 'seedling' | 'vegetative' | 'mature'
 *     stageLabel: string,        — Human-readable stage name
 *     transpirationMultiplier: number,  — RH% boost to add to ambient
 *     description: string,       — Explanation of transpiration behavior
 *   }
 */
export function getGrowthStage(plantDateString) {

    // ── Parse and validate the planting date ──
    const plantDate = new Date(plantDateString);

    if (isNaN(plantDate.getTime())) {
        throw new Error(
            `Invalid planting date: "${plantDateString}". ` +
            `Provide a valid date string (e.g., "2026-05-15" or "May 15, 2026").`
        );
    }

    // ── Calculate Days After Planting (DAP) ──
    // Use UTC midnight-to-midnight to avoid timezone edge cases.
    // A grower who plants on May 1 and checks on May 2 should see DAP=1.
    const today = new Date();
    const msPerDay = 1000 * 60 * 60 * 24;

    // Strip time components — compare calendar dates only
    const plantUTC = Date.UTC(plantDate.getFullYear(), plantDate.getMonth(), plantDate.getDate());
    const todayUTC = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
    const dap = Math.floor((todayUTC - plantUTC) / msPerDay);

    // Guard against future plant dates
    if (dap < 0) {
        return {
            plantDate: plantDate.toISOString().split('T')[0],
            today: today.toISOString().split('T')[0],
            daysAfterPlanting: dap,
            stage: 'not_planted',
            stageLabel: 'Not Yet Planted',
            transpirationMultiplier: 0,
            description:
                `Planting date is ${Math.abs(dap)} days in the future. ` +
                `No transpiration contribution until the crop is in the ground.`
        };
    }

    // ── Classify growth stage ──
    //
    // Stage thresholds are generalized across crop families.
    // Individual crop species have different actual Kc curves, but for
    // a sensor-less estimation model, these breakpoints provide actionable
    // accuracy for humidity management decisions.

    let stage, stageLabel, transpirationMultiplier, description;

    if (dap < 14) {
        // ── SEEDLING STAGE (DAP 0–13) ──
        // Minimal leaf area. Open soil surface dominates evaporation.
        // Small root zone = limited water uptake capacity.
        // Transpiration contribution is minor but non-zero.
        stage = 'seedling';
        stageLabel = '🌱 Seedling Stage';
        transpirationMultiplier = 2;    // +2% RH above ambient baseline
        description =
            `DAP ${dap}: Early seedling establishment. Minimal leaf area (LAI 0.3–0.8). ` +
            `Transpiration is low — soil surface evaporation dominates. ` +
            `RH contribution: +2% above ambient. Humidity management is not yet critical, ` +
            `but watch for damping-off pathogens (Pythium/Rhizoctonia) at soil surface.`;

    } else if (dap < 40) {
        // ── VEGETATIVE STAGE (DAP 14–39) ──
        // Rapid canopy expansion. Leaf area increasing geometrically.
        // Root system establishing, water uptake capacity growing fast.
        // This is the stage where humidity management becomes important.
        stage = 'vegetative';
        stageLabel = '🌿 Vegetative Growth';
        transpirationMultiplier = 6;    // +6% RH above ambient baseline
        description =
            `DAP ${dap}: Active vegetative growth. Canopy expanding rapidly (LAI 1.5–3.0). ` +
            `Transpiration rate increasing as leaf area and root capacity grow. ` +
            `RH contribution: +6% above ambient. Begin monitoring humidity carefully — ` +
            `Botrytis risk elevates as the canopy starts creating humid microclimates.`;

    } else {
        // ── MATURE CANOPY (DAP 40+) ──
        // Full canopy closure. Maximum leaf area index achieved.
        // Transpiration at peak rate — a mature tomato plant can transpire
        // 1–3 liters per day in an enclosed structure, rapidly saturating
        // the air volume if ventilation is inadequate.
        // This is the CRITICAL humidity management phase.
        stage = 'mature';
        stageLabel = '🌳 Mature Canopy';
        transpirationMultiplier = 12;   // +12% RH above ambient baseline
        description =
            `DAP ${dap}: Full canopy closure. MASSIVE moisture dumping (LAI 3.0–6.0+). ` +
            `A mature crop transpires 1–3 L/plant/day in enclosed conditions. ` +
            `RH contribution: +12% above ambient. ` +
            `THIS IS THE #1 HUMIDITY MANAGEMENT CHALLENGE. ` +
            `Aggressive venting, dehumidification, or night-time crack-venting is essential ` +
            `to prevent Botrytis cinerea sporulation cycles.`;
    }

    return {
        plantDate: plantDate.toISOString().split('T')[0],
        today: today.toISOString().split('T')[0],
        daysAfterPlanting: dap,
        stage,
        stageLabel,
        transpirationMultiplier,
        description
    };
}


// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 4: VAPOR PRESSURE DEFICIT (VPD) ESTIMATOR
// ═══════════════════════════════════════════════════════════════════════════════
//
// VPD is the single most important physiological metric for plant health in
// enclosed structures. It quantifies the "drying power" of the air — the
// difference between how much moisture the air CAN hold and how much it
// currently DOES hold.
//
// Physics:
//   VPD = SVP - AVP
//   Where:
//     SVP = Saturation Vapor Pressure at the current temperature
//     AVP = Actual Vapor Pressure = SVP × (RH / 100)
//     VPD = SVP × (1 - RH/100)
//
// SVP is calculated using the Tetens equation (1930), which is the standard
// approximation for meteorological applications:
//
//   SVP(T) = 0.6108 × exp( (17.27 × T) / (T + 237.3) )
//
//   Where T is temperature in °C, and SVP is in kilopascals (kPa).
//
// VPD Interpretation for greenhouse management:
//
//   ┌──────────────────────────────────────────────────────────┐
//   │  VPD (kPa)  │  Condition          │  Plant Response     │
//   │─────────────│─────────────────────│─────────────────────│
//   │  < 0.4      │  Dangerously humid  │  Stomata close,     │
//   │             │                     │  disease risk HIGH   │
//   │  0.4 – 0.8  │  Ideal low range    │  Efficient gas       │
//   │             │  (leafy greens)     │  exchange, low stress│
//   │  0.8 – 1.2  │  Ideal high range   │  Optimal for fruit   │
//   │             │  (fruiting crops)   │  crops (tomatoes)    │
//   │  1.2 – 1.6  │  Mildly stressed    │  Increased water     │
//   │             │                     │  demand              │
//   │  > 1.6      │  Dangerously dry    │  Stomata close to    │
//   │             │                     │  conserve water,     │
//   │             │                     │  photosynthesis stops│
//   └──────────────────────────────────────────────────────────┘
//
// Source:
//   - Tetens (1930) original vapor pressure equation
//   - Monteith & Unsworth (2013) Principles of Environmental Physics
//   - Argus Controls "Understanding VPD" technical bulletin
//
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Calculates the Vapor Pressure Deficit (VPD) from temperature and relative
 * humidity.
 *
 * @param {number} tempF — Air temperature in degrees Fahrenheit.
 *   This is the US Northeast field standard. Internally converted to °C
 *   for the Tetens equation.
 *
 * @param {number} rh — Relative humidity as a percentage (0–100).
 *   Values above 100 are clamped. Values below 0 are rejected.
 *
 * @returns {object} VPD analysis:
 *   {
 *     tempF: number,             — Input temperature (°F)
 *     tempC: number,             — Converted temperature (°C)
 *     rh: number,                — Input relative humidity (%)
 *     svp_kPa: number,           — Saturation Vapor Pressure (kPa)
 *     avp_kPa: number,           — Actual Vapor Pressure (kPa)
 *     vpd_kPa: number,           — Vapor Pressure Deficit (kPa)
 *     zone: string,              — VPD zone classification
 *     zoneLabel: string,         — Human-readable zone description
 *     recommendation: string,    — Actionable management guidance
 *   }
 */
export function calculateVPD(tempF, rh) {

    // ── Input validation ──
    if (typeof tempF !== 'number' || isNaN(tempF)) {
        throw new Error(`calculateVPD(): tempF must be a number, received: ${tempF}`);
    }
    if (typeof rh !== 'number' || isNaN(rh) || rh < 0) {
        throw new Error(`calculateVPD(): rh must be a number 0–100, received: ${rh}`);
    }

    // Clamp RH to physical maximum (can't exceed 100% without condensation)
    const clampedRH = Math.min(rh, 100);

    // ── Convert Fahrenheit to Celsius ──
    // Standard conversion: °C = (°F - 32) × 5/9
    const tempC = (tempF - 32) * 5 / 9;

    // ── Calculate Saturation Vapor Pressure (SVP) using Tetens equation ──
    //
    //   SVP = 0.6108 × exp( (17.27 × T) / (T + 237.3) )
    //
    // This gives SVP in kilopascals (kPa).
    // The Tetens equation is accurate to ±0.1% for temperatures -40°C to 50°C,
    // which covers the full range of greenhouse conditions.
    const svp = 0.6108 * Math.exp((17.27 * tempC) / (tempC + 237.3));

    // ── Calculate Actual Vapor Pressure (AVP) ──
    // AVP is the partial pressure of water vapor currently in the air.
    //   AVP = SVP × (RH / 100)
    const avp = svp * (clampedRH / 100);

    // ── Calculate Vapor Pressure Deficit ──
    // VPD = SVP - AVP = SVP × (1 - RH/100)
    // This is the "unmet capacity" of the air to hold more moisture.
    const vpd = svp - avp;

    // ── Classify VPD zone ──
    // These zones are derived from horticulture research and represent
    // the physiological response of most greenhouse crops.
    let zone, zoneLabel, recommendation;

    if (vpd < 0.4) {
        zone = 'danger_wet';
        zoneLabel = '🔵 Dangerously Humid';
        recommendation =
            'VPD below 0.4 kPa: Air is nearly saturated. Stomata close, transpiration stops, ' +
            'and disease risk is EXTREME. Fungal spores germinate in 2–4 hours at these levels. ' +
            'ACTION: Vent immediately, even if temperatures are low. Prioritize air exchange over warmth.';

    } else if (vpd < 0.8) {
        zone = 'ideal_low';
        zoneLabel = '🟢 Ideal — Leafy Greens Zone';
        recommendation =
            'VPD 0.4–0.8 kPa: Optimal for leafy greens and transplants. Stomata are fully open, ' +
            'gas exchange is efficient, and transpiration is gentle. ' +
            'This is the sweet spot for lettuce, spinach, herbs, and seedlings.';

    } else if (vpd < 1.2) {
        zone = 'ideal_high';
        zoneLabel = '🟢 Ideal — Fruiting Crops Zone';
        recommendation =
            'VPD 0.8–1.2 kPa: Optimal for fruiting crops (tomatoes, peppers, cucumbers). ' +
            'Strong transpiration drive moves nutrients through xylem efficiently. ' +
            'Calcium uptake is maximized, reducing blossom end rot risk.';

    } else if (vpd < 1.6) {
        zone = 'stress_mild';
        zoneLabel = '🟡 Mild Stress Zone';
        recommendation =
            'VPD 1.2–1.6 kPa: Plants are beginning to close stomata to conserve water. ' +
            'Transpiration exceeds root uptake capacity. Watch for wilting, especially in ' +
            'afternoon sun. Consider fogging, misting, or partial shade.';

    } else {
        zone = 'danger_dry';
        zoneLabel = '🔴 Dangerously Dry';
        recommendation =
            'VPD above 1.6 kPa: CRITICAL water stress. Stomata fully closed to prevent ' +
            'desiccation. Photosynthesis has stopped. Leaf curling and tip burn imminent. ' +
            'ACTION: Fog or mist immediately. Deploy shade cloth. Close vents on windward side ' +
            'to reduce convective drying.';
    }

    return {
        tempF,
        tempC: parseFloat(tempC.toFixed(2)),
        rh: clampedRH,
        svp_kPa: parseFloat(svp.toFixed(4)),
        avp_kPa: parseFloat(avp.toFixed(4)),
        vpd_kPa: parseFloat(vpd.toFixed(4)),
        zone,
        zoneLabel,
        recommendation
    };
}


// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 5: ORIENTATION AERODYNAMICS ENGINE
// ═══════════════════════════════════════════════════════════════════════════════
//
// Models the interaction between ambient wind and greenhouse geometry.
//
// Greenhouse orientation determines which structural faces (sidewalls vs. gable
// ends) are exposed to the prevailing wind. This critically affects:
//   1. Infiltration rate (cfm of unconditioned air entering)
//   2. Stack-effect efficiency (thermal buoyancy venting)
//   3. Bernoulli pressure differentials across the structure
//
// Compass Convention:
//   0° / 360° = North, 90° = East, 180° = South, 270° = West
//   (Meteorological: degrees indicate where wind blows FROM)
//
// Two supported orientations:
//   'NS' — Ridge runs North-South. Long sidewalls face East and West.
//   'EW' — Ridge runs East-West. Long sidewalls face North and South.
//
// Aerodynamic Principles:
//
//   CROSS-WIND (wind hits a sidewall):
//     Windward:  Positive pressure coefficient (Cp ≈ +0.6 to +0.8)
//     Leeward:   Negative pressure coefficient (Cp ≈ -0.3 to -0.5)
//     Creates a strong pressure differential driving cross-ventilation.
//     RISK: High blowout force on windward side. Structural stress.
//
//   PARALLEL FLOW (wind hits a gable end, flows along sidewalls):
//     Both sidewalls: Negative Cp (≈ -0.2 to -0.4) — Bernoulli vacuum
//     Wind accelerates over/around the structure, reducing static pressure
//     on both long sides simultaneously.
//     BENEFIT: Gentle, even suction ventilation without violent cross-drafts.
//     This is the aerodynamically SAFE ventilation mode.
//
// Source:
//   - ASHRAE Handbook: Fundamentals (Wind Pressure Coefficients)
//   - Hellickson & Walker (1983) Ventilation of Agricultural Structures
//   - NGMA Structural Design Manual for greenhouses
//
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Classifies a meteorological wind direction into compass bearing and quadrant.
 *
 * @param {number} windDirDeg — Meteorological wind direction (where wind
 *   blows FROM), 0–360°.
 * @returns {{ degrees: number, from: string, quadrant: string }}
 */
function classifyWindDirection(windDirDeg) {
    // Normalize to 0–360 range (handles negatives and >360 values)
    const dir = ((windDirDeg % 360) + 360) % 360;

    // 16-point compass classification for human-readable output
    const compass = [
        'N', 'NNE', 'NE', 'ENE',
        'E', 'ESE', 'SE', 'SSE',
        'S', 'SSW', 'SW', 'WSW',
        'W', 'WNW', 'NW', 'NNW'
    ];
    const index = Math.round(dir / 22.5) % 16;

    return {
        degrees: dir,
        from: compass[index],

        // 4-quadrant classification: which 90° sector the wind originates from
        //   315–045° → 'N'   (North quadrant)
        //   045–135° → 'E'   (East quadrant)
        //   135–225° → 'S'   (South quadrant)
        //   225–315° → 'W'   (West quadrant)
        quadrant: dir >= 315 || dir < 45 ? 'N' :
            dir >= 45 && dir < 135 ? 'E' :
                dir >= 135 && dir < 225 ? 'S' :
                    'W'
    };
}


/**
 * Calculates the aerodynamic interaction between wind and a greenhouse structure.
 *
 * Determines:
 *   - Which structural face is windward vs. leeward
 *   - Whether the wind creates a Bernoulli vacuum (parallel flow) or a
 *     direct cross-wind pressure differential
 *   - Approximate pressure coefficients and their physical meaning
 *   - Actionable venting instructions
 *
 * @param {number} windDirDegrees — Meteorological wind direction
 *   (where wind blows FROM), 0–360°.
 *
 * @param {string} orientation — Greenhouse ridge orientation:
 *   'NS' (ridge runs North-South, sidewalls face E/W) or
 *   'EW' (ridge runs East-West, sidewalls face N/S).
 *
 * @returns {object} Wind dynamics analysis:
 *   {
 *     windFrom: string,          — 16-point compass bearing (e.g., 'NNW')
 *     windDegrees: number,       — Normalized wind direction (0–360°)
 *     windQuadrant: string,      — 4-point quadrant ('N', 'E', 'S', 'W')
 *     orientation: string,       — Normalized orientation ('NS' or 'EW')
 *     sidewallFaces: string[],   — Which directions the long sidewalls face
 *     gableEndFaces: string[],   — Which directions the short gable ends face
 *     windward: string,          — The side receiving direct wind pressure
 *     leeward: string,           — The sheltered side
 *     isBernoulliMode: boolean,  — True when wind flows parallel to sidewalls
 *     pressureProfile: object,   — Pressure coefficients and Pascal estimates
 *     ventInstructions: string[],— Actionable field instructions
 *     riskLevel: string,         — 'safe_vacuum' | 'cross_wind' | 'high_blowout'
 *     warnings: string[]         — Safety alerts
 *   }
 */
export function calculateWindDynamics(windDirDegrees, orientation = 'NS') {

    const wind = classifyWindDirection(windDirDegrees);
    const normOrient = orientation.toUpperCase().replace(/[^NSEW]/g, '');

    // ── Base result structure ──
    const result = {
        windFrom: wind.from,
        windDegrees: wind.degrees,
        windQuadrant: wind.quadrant,
        orientation: normOrient,
        sidewallFaces: null,        // Which directions the long sidewalls face
        gableEndFaces: null,        // Which directions the short gable ends face
        windward: null,             // The side receiving direct wind pressure
        leeward: null,              // The sheltered side
        isBernoulliMode: false,     // True when wind flows parallel to sidewalls
        pressureProfile: null,      // Description of the pressure differential
        ventInstructions: [],       // Actionable field instructions
        riskLevel: null,            // Overall wind risk classification
        warnings: []
    };

    // ── Define structural geometry based on orientation ──
    //
    //   NS Orientation:              EW Orientation:
    //   Ridge runs N↔S               Ridge runs E↔W
    //   Long sidewalls face E & W    Long sidewalls face N & S
    //   Short gable ends face N & S  Short gable ends face E & W
    //
    //   NS (top view):     EW (top view):
    //       N                   N
    //    ┌─────┐             ┌───────────┐
    //  W │     │ E         W │           │ E
    //    │     │             └───────────┘
    //    │     │                 S
    //    └─────┘
    //       S

    if (normOrient === 'NS') {
        result.sidewallFaces = ['E', 'W'];
        result.gableEndFaces = ['N', 'S'];
    } else {
        result.sidewallFaces = ['N', 'S'];
        result.gableEndFaces = ['E', 'W'];
    }

    // ── Determine wind-structure interaction mode ──
    //
    // If the wind quadrant matches a GABLE END face → parallel flow (Bernoulli)
    //   Wind enters the narrow gable end and flows ALONG both long sidewalls.
    //   Both sidewalls experience negative pressure (suction).
    //
    // If the wind quadrant matches a SIDEWALL face → direct cross-wind
    //   Wind hits the broad sidewall face-on. High-pressure windward side,
    //   low-pressure leeward side. This is the HIGH BLOWOUT RISK scenario.

    const isParallelFlow = result.gableEndFaces.includes(wind.quadrant);

    if (isParallelFlow) {
        // ═══════════════════════════════════════
        // BERNOULLI VACUUM MODE (Safe)
        // ═══════════════════════════════════════
        // Wind hits the gable end and flows ALONG both sidewalls.
        // Bernoulli's principle: faster airflow over a surface = lower
        // static pressure. Both sidewalls experience suction (negative Cp).
        //
        // This is aerodynamically favorable for ventilation — opening both
        // sidewalls creates a gentle, even draft without the violent
        // cross-wind of direct exposure.

        result.isBernoulliMode = true;
        result.riskLevel = 'safe_vacuum';
        result.windward = `${wind.quadrant} gable end (direct impact)`;
        result.leeward = `${
            wind.quadrant === result.gableEndFaces[0]
                ? result.gableEndFaces[1]
                : result.gableEndFaces[0]
        } gable end (wake zone)`;

        result.pressureProfile = {
            mode: 'Bernoulli parallel flow',
            windwardGable: 'Cp ≈ +0.7 (positive pressure on gable face)',
            sidewalls: 'Cp ≈ -0.3 (BOTH sides experience suction — safe vacuum)',
            leewardGable: 'Cp ≈ -0.4 (wake turbulence zone)'
        };

        result.ventInstructions = [
            `✅ SAFE: Wind from ${wind.from} flows PARALLEL to the ${result.sidewallFaces.join(' & ')} sidewalls.`,
            `Bernoulli vacuum effect active on BOTH ${result.sidewallFaces.join(' & ')} sides.`,
            `Open BOTH sidewalls for gentle, even exhaust ventilation.`,
            `This is the safest and most efficient natural ventilation mode.`,
            `No blowout risk — wind pressure is PULLING air out, not pushing in.`
        ];

    } else {
        // ═══════════════════════════════════════
        // DIRECT CROSS-WIND MODE (Caution)
        // ═══════════════════════════════════════
        // Wind strikes a long sidewall face-on.
        //
        // Windward side: High positive pressure — air is being PUSHED into the
        //   structure through every gap, crack, and vent opening.
        // Leeward side: Negative pressure — suction pulls air OUT.
        //
        // This creates the strongest possible ventilation drive, but also
        // the highest structural loads. On poly-covered high-tunnels,
        // strong cross-winds can cause catastrophic poly blowout.

        result.isBernoulliMode = false;

        // Determine which sidewall is windward
        if (result.sidewallFaces.includes(wind.quadrant)) {
            result.windward = `${wind.quadrant} sidewall (BROADSIDE — direct exposure)`;
            result.leeward = `${
                wind.quadrant === result.sidewallFaces[0]
                    ? result.sidewallFaces[1]
                    : result.sidewallFaces[0]
            } sidewall (sheltered)`;
        } else {
            // Oblique angle — wind has components along both axes
            result.windward = `${wind.quadrant} (oblique approach)`;
            result.leeward = 'opposite side';
        }

        result.riskLevel = 'cross_wind';

        result.pressureProfile = {
            mode: 'Direct cross-wind',
            windwardSidewall: 'Cp ≈ +0.7 (positive pressure — air PUSHING IN)',
            leewardSidewall: 'Cp ≈ -0.4 (negative pressure — suction pulling OUT)'
        };

        result.ventInstructions = [
            `⚠️ CROSS-WIND: Wind from ${wind.from} is hitting the ${result.windward}.`,
            `HIGH BLOWOUT RISK on the windward side.`,
            `LEEWARD side (${result.leeward}) is safe for exhaust venting.`,
            `For cooling: open LEEWARD side first, then optionally crack windward for cross-flow.`,
            `On poly-covered tunnels: NEVER fully open the windward side in cross-wind.`
        ];
    }

    // ── Universal wind safety warnings ──
    // These apply regardless of wind-structure interaction mode.

    // Note: We don't have windSpeed as a parameter in the simplified signature.
    // The caller can check speed separately. If they need speed-based warnings,
    // they can combine this output with their wind speed data.

    return result;
}


// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 6: UTILITY EXPORTS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * List all valid crop profile keys.
 * Useful for UI dropdowns and input validation.
 */
export const CROP_TYPES = Object.keys(CROP_PROFILES);

/**
 * Fahrenheit ↔ Celsius converters (field convenience).
 * Maine growers use °F; Open-Meteo can return °C.
 */
export const tempConvert = {
    fToC: (f) => (f - 32) * 5 / 9,
    cToF: (c) => (c * 9 / 5) + 32
};
