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
// SECTION 4: VAPOR PRESSURE DEFICIT (VPD) — PURE PHYSICS
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
// This function is now PURE PHYSICS — it returns SVP, AVP, and VPD only.
// Growth-phase-aware health evaluation has moved to getVPDStatus().
//
// Source:
//   - Tetens (1930) original vapor pressure equation
//   - Monteith & Unsworth (2013) Principles of Environmental Physics
//   - Argus Controls "Understanding VPD" technical bulletin
//
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Calculates the Vapor Pressure Deficit (VPD) from temperature and relative
 * humidity using the Tetens equation. Pure thermodynamic calculation — no
 * zone classification (see getVPDStatus for phase-aware evaluation).
 *
 * @param {number} tempF — Air temperature in degrees Fahrenheit.
 * @param {number} rh — Relative humidity as a percentage (0–100).
 *
 * @returns {object} VPD physics:
 *   {
 *     tempF: number,      — Input temperature (°F)
 *     tempC: number,      — Converted temperature (°C)
 *     rh: number,         — Clamped relative humidity (%)
 *     svp_kPa: number,    — Saturation Vapor Pressure (kPa)
 *     avp_kPa: number,    — Actual Vapor Pressure (kPa)
 *     vpd_kPa: number,    — Vapor Pressure Deficit (kPa)
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

    // ── Vapor Pressure Deficit ──
    //   VPD = SVP - AVP = the air's remaining capacity to absorb moisture.
    const vpd = svp - avp;

    return {
        tempF,
        tempC: parseFloat(tempC.toFixed(2)),
        rh: clampedRH,
        svp_kPa: parseFloat(svp.toFixed(4)),
        avp_kPa: parseFloat(avp.toFixed(4)),
        vpd_kPa: parseFloat(vpd.toFixed(4))
    };
}


// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 4b: VPD HEALTH STATUS — GROWTH-PHASE-AWARE EVALUATION
// ═══════════════════════════════════════════════════════════════════════════════
//
// VPD requirements shift dramatically across growth phases. A VPD that is
// "ideal" for a flowering tomato is dangerously high for a germinating
// seedling — the tiny root system cannot keep up with transpiration demand.
//
// Phase-specific optimal VPD ranges (kPa):
//
//   ┌──────────────────────────────────────────────────────────────────────┐
//   │  Phase         │  Optimal VPD   │  Reason                          │
//   │────────────────│────────────────│──────────────────────────────────│
//   │  Germination   │  0.4 – 0.8     │  Minimal root system. Gentle     │
//   │                │                │  transpiration. High humidity     │
//   │                │                │  prevents desiccation of tender   │
//   │                │                │  cotyledons.                      │
//   │────────────────│────────────────│──────────────────────────────────│
//   │  Vegetative    │  0.8 – 1.2     │  Expanding canopy. Roots can     │
//   │                │                │  support moderate transpiration.  │
//   │                │                │  Strong VPD drives calcium uptake │
//   │                │                │  and prevents tip burn.           │
//   │────────────────│────────────────│──────────────────────────────────│
//   │  Flowering     │  1.2 – 1.6     │  Full root system. Max nutrient  │
//   │                │                │  transport needed for fruit fill. │
//   │                │                │  Higher VPD prevents Botrytis on  │
//   │                │                │  open flower petals.              │
//   └──────────────────────────────────────────────────────────────────────┘
//
// Critical thresholds (all phases):
//   VPD < 0.20 kPa  → CRITICAL: Free water condensing on leaf surfaces.
//                      Botrytis cinerea sporulation within 2-4 hours.
//                      Glazing water film degrades solar transmittance.
//   VPD < 0.43 kPa  → DANGER: Condensation risk on poly glazing surface.
//                      Water film forms, reducing solar gain by ~15%.
//                      Guttation (plant "sweating") begins.
//   VPD > 2.0  kPa  → MITE RISK: Two-spotted spider mite (Tetranychus
//                      urticae) populations explode in dry conditions.
//                      Drought-stressed leaves have weaker defenses.
//
// Source:
//   - Argus Controls "Understanding VPD" (phase-specific ranges)
//   - Boulard & Wang (2000) greenhouse VPD management
//   - Elad (1997) Botrytis cinerea sporulation vs. microclimate
//   - van Lenteren (2000) IOBC/WPRS Bulletin — spider mite ecology
//
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Evaluates VPD health status relative to the crop's current growth phase.
 *
 * @param {number} vpd — Vapor Pressure Deficit in kPa (from calculateVPD).
 * @param {'germination' | 'vegetative' | 'flowering'} phase — Current
 *   growth phase of the crop. Determines the optimal VPD target range.
 *
 * @returns {object} Phase-aware VPD health evaluation:
 *   {
 *     status: 'Optimal' | 'Sub-optimal',  — Whether VPD is in phase range
 *     phase: string,                       — Echo of input phase
 *     optimalRange: { min, max },          — Ideal VPD range for this phase
 *     deviation_kPa: number,               — How far outside range (0 if in range)
 *     isDanger: boolean,                   — True if vpd < 0.43 (condensation)
 *     isCritical: boolean,                 — True if vpd < 0.20 (free water)
 *     isMiteRisk: boolean,                 — True if vpd > 2.0 (spider mites)
 *     recommendation: string,              — Actionable guidance
 *     warnings: string[]                   — Active threat warnings
 *   }
 */
export function getVPDStatus(vpd, phase) {

    // ── Input validation ──
    if (typeof vpd !== 'number' || isNaN(vpd)) {
        throw new Error(`getVPDStatus(): vpd must be a number, received: ${vpd}`);
    }
    const validPhases = ['germination', 'vegetative', 'flowering'];
    const normPhase = (phase || '').toLowerCase().trim();
    if (!validPhases.includes(normPhase)) {
        throw new Error(
            `getVPDStatus(): phase must be one of [${validPhases.join(', ')}], ` +
            `received: "${phase}"`
        );
    }

    // ── Phase-specific optimal VPD ranges (kPa) ──
    const PHASE_RANGES = {
        germination: { min: 0.4, max: 0.8 },
        vegetative: { min: 0.8, max: 1.2 },
        flowering: { min: 1.2, max: 1.6 }
    };

    const range = PHASE_RANGES[normPhase];

    // ── Determine if VPD is within the optimal window ──
    const inRange = vpd >= range.min && vpd <= range.max;
    const deviation = inRange ? 0
        : vpd < range.min ? parseFloat((range.min - vpd).toFixed(4))
            : parseFloat((vpd - range.max).toFixed(4));

    // ── Universal critical thresholds (physics, not phase-dependent) ──
    //
    //   0.20 kPa: Dew point depression is near zero. Free water condenses
    //             on ANY surface cooler than air temp — leaf surfaces,
    //             fruit clusters, and poly glazing. This is the threshold
    //             where Botrytis cinerea sporulation becomes inevitable
    //             within 2-4 hours of sustained conditions.
    //
    //   0.43 kPa: The glazing condensation onset point. Double-poly
    //             inflated tunnels start forming a water film on the inner
    //             glazing surface. This film scatters and absorbs incoming
    //             solar radiation, reducing transmittance by ~15%.
    //             Guttation droplets appear on leaf tips (tomatoes, cukes).
    //
    //   2.0 kPa:  Two-spotted spider mite (Tetranychus urticae) reproduction
    //             rate peaks in hot, dry conditions. The mites thrive because:
    //             (a) drought-stressed leaves have reduced defensive compounds,
    //             (b) low humidity suppresses the entomopathogenic fungi
    //             (Beauveria, Metarhizium) that normally keep mite populations
    //             in check.

    const isCritical = vpd < 0.20;
    const isDanger = vpd < 0.43;
    const isMiteRisk = vpd > 2.0;

    // ── Build recommendation ──
    let recommendation;
    if (isCritical) {
        recommendation =
            `CRITICAL: VPD ${vpd.toFixed(2)} kPa — FREE WATER on leaf surfaces. ` +
            `Botrytis sporulation imminent (2-4 hr). Vent aggressively AND run heat ` +
            `to raise temperature differential. This is the #1 crop loss scenario.`;
    } else if (isDanger) {
        recommendation =
            `DANGER: VPD ${vpd.toFixed(2)} kPa — Condensation forming on glazing. ` +
            `Solar transmittance degraded. Guttation active. Crack vents and ` +
            `run minimal heat to break the dew point.`;
    } else if (isMiteRisk) {
        recommendation =
            `MITE RISK: VPD ${vpd.toFixed(2)} kPa — Dangerously dry. Spider mite ` +
            `populations will explode. Deploy shade cloth, increase misting frequency, ` +
            `and scout undersides of lower canopy leaves immediately.`;
    } else if (inRange) {
        recommendation =
            `Optimal: VPD ${vpd.toFixed(2)} kPa is within the ${normPhase} target ` +
            `range of ${range.min}–${range.max} kPa. No corrective action needed.`;
    } else if (vpd < range.min) {
        recommendation =
            `Sub-optimal: VPD ${vpd.toFixed(2)} kPa is ${deviation.toFixed(2)} kPa ` +
            `below the ${normPhase} floor of ${range.min} kPa. Increase ventilation ` +
            `or raise temperature to widen the deficit.`;
    } else {
        recommendation =
            `Sub-optimal: VPD ${vpd.toFixed(2)} kPa is ${deviation.toFixed(2)} kPa ` +
            `above the ${normPhase} ceiling of ${range.max} kPa. Reduce ventilation, ` +
            `increase misting, or deploy shade cloth.`;
    }

    // ── Collect active warnings ──
    const warnings = [];
    if (isCritical) {
        warnings.push(
            '🚨 FREE WATER: VPD < 0.20 kPa. Liquid water on leaves AND glazing. ' +
            'Botrytis cinerea sporulation threshold EXCEEDED.'
        );
    }
    if (isDanger && !isCritical) {
        warnings.push(
            '⚠️ CONDENSATION: VPD < 0.43 kPa. Water film forming on poly glazing. ' +
            'Solar transmittance reduced ~15%. Guttation droplets on leaf tips.'
        );
    }
    if (isMiteRisk) {
        warnings.push(
            '🕷️ SPIDER MITE ALERT: VPD > 2.0 kPa. Tetranychus urticae reproduction ' +
            'peaks in hot, dry conditions. Scout lower canopy immediately.'
        );
    }

    return {
        status: inRange ? 'Optimal' : 'Sub-optimal',
        phase: normPhase,
        optimalRange: { min: range.min, max: range.max },
        deviation_kPa: deviation,
        isDanger,
        isCritical,
        isMiteRisk,
        recommendation,
        warnings
    };
}


// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 4c: GROWING DEGREE DAYS (GDD) — PEST PRESSURE MODEL
// ═══════════════════════════════════════════════════════════════════════════════
//
// Growing Degree Days (GDD) are the standard entomological method for
// predicting pest lifecycle events. Insects are ectotherms — their metabolic
// rate is directly controlled by ambient temperature. Each species has a
// "base temperature" below which development effectively stops.
//
// The daily GDD accumulation is:
//
//   GDD = max(0, T_avg - T_base)
//
// Where:
//   T_avg  = average daily temperature (°F, using single-sine or simple avg)
//   T_base = species-specific developmental threshold (°F)
//
// For a single instantaneous reading (what Open-Meteo gives us), we use
// the current temperature as a proxy for the daily contribution at that
// moment. The caller accumulates these readings over time.
//
// Pest Species Modeled:
//
//   ┌─────────────────────────────────────────────────────────────────────────┐
//   │  Pest           │  Base Temp  │  GDD to 1st Gen  │  Source             │
//   │─────────────────│────────────│─────────────────│─────────────────────│
//   │  Western Flower │  51.3°F    │  ~270 GDD(°F)   │  Lublinkhof &       │
//   │  Thrips (WFT)   │  (10.7°C)  │                 │  Foster 1977        │
//   │  Frankliniella  │            │                 │  UC IPM Bulletin    │
//   │  occidentalis   │            │                 │                     │
//   │─────────────────│────────────│─────────────────│─────────────────────│
//   │  Greenhouse     │  46.9°F    │  ~360 GDD(°F)   │  Osborne 1982       │
//   │  Whitefly (GWF) │  (8.3°C)   │                 │  van Roermund &     │
//   │  Trialeurodes   │            │                 │  van Lenteren 1992  │
//   │  vaporariorum   │            │                 │                     │
//   └─────────────────────────────────────────────────────────────────────────┘
//
// Usage pattern:
//   Each weather fetch → calculateGDD(tempF, 51.3) → accumulate into state.
//   When accumulator crosses 270 GDD → alert: "Thrips 1st generation emerging."
//
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Preset base temperatures for common greenhouse pests (°F).
 * Use these with calculateGDD() for integrated pest management.
 */
export const PEST_GDD_BASES = {
    thrips: 51.3,   // Western Flower Thrips (WFT) — Frankliniella occidentalis
    whitefly: 46.9    // Greenhouse Whitefly (GWF) — Trialeurodes vaporariorum
};

/**
 * First-generation emergence thresholds (cumulative GDD in °F-days).
 * When accumulated GDD crosses these values, the first generation of
 * the pest is expected to reach maturity and begin reproducing.
 */
export const PEST_GDD_THRESHOLDS = {
    thrips: 270,    // ~270 GDD(°F) from biofix to 1st adult emergence
    whitefly: 360     // ~360 GDD(°F) from egg to adult (one generation)
};

/**
 * Calculates the instantaneous Growing Degree Day contribution for a
 * given temperature reading. GDD = max(0, tempF - baseTempF).
 *
 * @param {number} tempF — Current air temperature in °F.
 * @param {number} baseTempF — Species-specific developmental base temp (°F).
 *   Use PEST_GDD_BASES.thrips (51.3) or PEST_GDD_BASES.whitefly (46.9).
 *
 * @returns {object} GDD contribution:
 *   {
 *     tempF: number,              — Input temperature
 *     baseTempF: number,          — Base temperature used
 *     gdd: number,                — GDD contribution (≥ 0)
 *     isAccumulating: boolean,    — True if temp > base (development active)
 *     description: string         — Human-readable explanation
 *   }
 */
export function calculateGDD(tempF, baseTempF) {

    // ── Input validation ──
    if (typeof tempF !== 'number' || isNaN(tempF)) {
        throw new Error(`calculateGDD(): tempF must be a number, received: ${tempF}`);
    }
    if (typeof baseTempF !== 'number' || isNaN(baseTempF)) {
        throw new Error(`calculateGDD(): baseTempF must be a number, received: ${baseTempF}`);
    }

    // ── Core GDD calculation ──
    //   GDD = max(0, T_current - T_base)
    //   No development occurs below the base temperature.
    const gdd = Math.max(0, tempF - baseTempF);
    const isAccumulating = gdd > 0;

    // ── Identify pest for description ──
    let pestLabel = `base ${baseTempF}°F`;
    if (Math.abs(baseTempF - PEST_GDD_BASES.thrips) < 0.1) {
        pestLabel = 'WFT (Western Flower Thrips)';
    } else if (Math.abs(baseTempF - PEST_GDD_BASES.whitefly) < 0.1) {
        pestLabel = 'GWF (Greenhouse Whitefly)';
    }

    const description = isAccumulating
        ? `${pestLabel}: +${gdd.toFixed(1)} GDD(°F) at ${Math.round(tempF)}°F. ` +
        `Development active — pest lifecycle advancing.`
        : `${pestLabel}: 0 GDD at ${Math.round(tempF)}°F (below base ${baseTempF}°F). ` +
        `Development paused — temperature too cold for this pest.`;

    return {
        tempF,
        baseTempF,
        gdd: parseFloat(gdd.toFixed(2)),
        isAccumulating,
        description
    };
}


// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 4d: STRUCTURAL THERMAL MODIFIERS
// ═══════════════════════════════════════════════════════════════════════════════
//
// Models how greenhouse geometry, glazing type, and current VPD conditions
// modify the thermal environment relative to ambient outdoor conditions.
//
// Key physics:
//
// 1. THERMAL MASS — Larger air volumes change temperature more slowly.
//    A 30×96×10 ft tunnel (28,800 ft³) is the baseline. Smaller structures
//    are more volatile; larger ones are more thermally stable.
//    Modeled with logarithmic scale: thermalMass = log10(V/V_base + 1) + 0.7
//
// 2. GLAZING SOLAR TRANSMITTANCE — The critical factor.
//
//    Single Poly (6-mil polyethylene):
//      - Solar PAR transmittance: ~85-88% (new)
//      - Infrared (IR) transmittance: HIGH — heat bleeds out rapidly at night.
//      - solarGainMultiplier: 1.20 (fast daytime heat gain)
//      - nightHeatRetentionF: 0°F above ambient (no IR barrier)
//
//    Double Poly (inflated double-layer):
//      - Solar PAR transmittance: ~75-80% (new, some scattered by 2nd layer)
//      - Infrared (IR) transmittance: LOW — dead-air gap is insulator.
//      - solarGainMultiplier: 0.85 (slower daytime solar spike)
//      - nightHeatRetentionF: 5°F above ambient (IR barrier retains heat)
//
//    *** CONDENSATION DEGRADATION (VPD-dependent) ***
//      When estVpd < 0.43 kPa, water vapor condenses on the inner surface
//      of the poly glazing. This water film:
//        (a) ABSORBS shortwave solar radiation (350-700 nm)
//        (b) SCATTERS the remaining transmitted light diffusely
//        (c) Net effect: ~15% further reduction in solar transmittance
//
//      For double poly:
//        Effective solarGainMultiplier = 0.85 × 0.85 = 0.7225
//        The greenhouse heats up SLOWER during morning warm-up.
//        BUT the moisture environment is already catastrophic (disease risk).
//
//      For single poly, condensation also occurs but the rapid re-evaporation
//      from wind exposure and thin film means the practical impact is smaller.
//      We model a 10% reduction for single poly under condensation.
//
//    Source:
//      - Papadopoulos & Hao (1997) light transmission through double-poly
//      - NRAES-33 (1994) Greenhouse Engineering, Cornell
//      - Max et al. (2012) condensation effects on greenhouse light environment
//
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Calculates thermal environment modifiers based on greenhouse structure
 * and current VPD conditions.
 *
 * @param {number} width — Greenhouse width in feet.
 * @param {number} length — Greenhouse length in feet.
 * @param {'single' | 'double'} glazing — Glazing type.
 * @param {number} [estVpd] — Estimated interior VPD in kPa (optional).
 *   When provided and < 0.43, triggers condensation-degraded transmittance.
 *
 * @returns {object} Thermal modifiers:
 *   {
 *     sqft: number,                    — Floor area (ft²)
 *     volume: number,                  — Air volume (ft³)
 *     thermalMass: number,             — Thermal inertia coefficient
 *     solarGainMultiplier: number,     — Solar transmittance factor
 *     nightHeatRetentionF: number,     — Night temp bonus (°F above ambient)
 *     glazingLabel: string,            — Human-readable glazing description
 *     isCondensationDegraded: boolean, — True if VPD triggered degradation
 *     condensationPenalty: number,     — Transmittance reduction factor (0–1)
 *     dayTempDeltaF: number,           — Estimated interior day temp delta
 *     nightTempDeltaF: number,         — Estimated interior night temp delta
 *     warnings: string[]               — Active structural warnings
 *   }
 */
export function calculateThermalModifiers(width, length, glazing, estVpd) {

    const AVG_HEIGHT_FT = 10;
    const w = width || 30;
    const l = length || 96;
    const sqft = w * l;
    const volume = sqft * AVG_HEIGHT_FT;  // cubic feet

    // ── Thermal mass coefficient ──
    //   Baseline: 30×96×10 = 28,800 ft³ → coefficient ~1.0
    //   Smaller volumes → < 1 (volatile temp swings)
    //   Larger volumes → > 1 (stable, slow response)
    const BASELINE_VOLUME = 28800;
    const thermalMass = Math.log10(volume / BASELINE_VOLUME + 1) + 0.7;

    // ── Base glazing properties (DRY conditions) ──
    const isDouble = (glazing || 'single') === 'double';
    let solarGainMultiplier, nightHeatRetentionF, glazingLabel;

    if (isDouble) {
        solarGainMultiplier = 0.85;    // 15% slower daytime solar spike
        nightHeatRetentionF = 5;       // +5°F above ambient at night
        glazingLabel = 'Double Poly';
    } else {
        solarGainMultiplier = 1.20;    // +20% faster daytime solar spike
        nightHeatRetentionF = 0;       // No night retention
        glazingLabel = 'Single Poly';
    }

    // ── Condensation degradation (VPD-dependent) ──
    //   When VPD < 0.43 kPa, water film forms on inner glazing surface.
    //   This absorbs and scatters incoming solar radiation.
    //
    //   Double poly: -15% (0.85 factor) → 0.85 × 0.85 = 0.7225
    //     The dead-air gap RETAINS moisture → thicker, more persistent film.
    //
    //   Single poly: -10% (0.90 factor) → 1.20 × 0.90 = 1.08
    //     Wind exposure on outer surface → faster re-evaporation, thinner film.

    let isCondensationDegraded = false;
    let condensationPenalty = 1.0;  // No penalty by default
    const warnings = [];

    if (typeof estVpd === 'number' && !isNaN(estVpd) && estVpd < 0.43) {
        isCondensationDegraded = true;

        if (isDouble) {
            condensationPenalty = 0.85;  // 15% reduction
            warnings.push(
                '💧 CONDENSATION ON GLAZING: VPD < 0.43 kPa. Water film on inner ' +
                'double-poly surface. Solar transmittance reduced by 15%. ' +
                'Morning warm-up will be delayed. Crack vents + run heat to break dew point.'
            );
        } else {
            condensationPenalty = 0.90;  // 10% reduction
            warnings.push(
                '💧 CONDENSATION: VPD < 0.43 kPa. Light water film on single-poly. ' +
                'Solar transmittance reduced by ~10%. Wind exposure will help ' +
                're-evaporate, but crack vents to promote air circulation.'
            );
        }

        solarGainMultiplier *= condensationPenalty;
    }

    // ── Estimated interior temperature deltas ──
    //   dayTempDeltaF: How many °F above ambient during peak solar gain.
    //     Base solar gain ≈ +15°F in a standard tunnel, modified by:
    //       - solarGainMultiplier (glazing + condensation effects)
    //       - thermalMass (larger volumes heat slower)
    //
    //   nightTempDeltaF: How many °F above ambient at night.
    //     Only double-poly retains significant night heat.

    const dayTempDeltaF = Math.round(15 * solarGainMultiplier * thermalMass);
    const nightTempDeltaF = nightHeatRetentionF;

    // ── Add critical condensation warning ──
    if (typeof estVpd === 'number' && !isNaN(estVpd) && estVpd < 0.20) {
        warnings.push(
            '🚨 FREE WATER: VPD < 0.20 kPa. Liquid water condensing on ALL ' +
            'surfaces — glazing, leaf surfaces, fruit clusters, and structural steel. ' +
            'Botrytis cinerea sporulation threshold EXCEEDED. This is an emergency.'
        );
    }

    return {
        sqft,
        volume,
        thermalMass: parseFloat(thermalMass.toFixed(4)),
        solarGainMultiplier: parseFloat(solarGainMultiplier.toFixed(4)),
        nightHeatRetentionF,
        glazingLabel,
        isCondensationDegraded,
        condensationPenalty: parseFloat(condensationPenalty.toFixed(4)),
        dayTempDeltaF,
        nightTempDeltaF,
        warnings
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
        result.leeward = `${wind.quadrant === result.gableEndFaces[0]
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
            result.leeward = `${wind.quadrant === result.sidewallFaces[0]
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

/**
 * Growth phase constants — matches the data model's growthPhase field.
 * Used as input to getVPDStatus().
 */
export const GROWTH_PHASES = ['germination', 'vegetative', 'flowering'];


// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 7: INDIVIDUAL HOUSE RECOMMENDATION ENGINE
// ═══════════════════════════════════════════════════════════════════════════════
//
// Evaluates a single greenhouse structure against current weather conditions
// and produces a prioritized list of actionable alerts.
//
// The 9-gate priority cascade processes conditions from most-urgent to
// least-urgent. Each gate can emit one or more alerts at a severity level
// (critical > warning > advisory > ok). The cascade does NOT short-circuit:
// all gates are evaluated, and the highest-severity alert sets the overall
// priority for the structure.
//
// Gate Order (top = highest priority):
//
//   ┌───────┬───────────────────────────────────┬────────────────────────┐
//   │  Gate │  Condition                        │  Priority Level        │
//   │───────│───────────────────────────────────│────────────────────────│
//   │   1   │  Wind > 30 mph (any direction)    │  critical              │
//   │       │  Wind > 22 mph (broadside hit)    │  warning               │
//   │   2   │  VPD < 0.20 kPa + Temp > 55°F    │  critical (Botrytis)   │
//   │   3   │  Leaf wetness > 5 hours           │  warning (Mildew)      │
//   │   4   │  Temp > 85°F + VPD > 2.0 kPa     │  critical (Spider mite)│
//   │   5   │  Cumulative GDD past threshold    │  warning (Pest emerge) │
//   │   6   │  Night temp below crop floor      │  critical/warning      │
//   │   7   │  Day temp above crop ceiling      │  warning/advisory      │
//   │   8   │  Wind 10–22 mph (directional)     │  advisory              │
//   │   9   │  All clear — deadband nominal     │  ok                    │
//   └───────────────────────────────────────────────────────────────────────┘
//
// Input contract — house object:
//   {
//     crops: string[],         — Array of CROP_PROFILES keys (e.g. ['solanaceous', 'coldHardyGreens'])
//     plantDate: string,       — ISO 8601 date string (e.g. '2026-03-15')
//     width: number,           — Structure width in feet
//     length: number,          — Structure length in feet
//     glazing: 'single'|'double',
//     heating: 'heated'|'unheated',
//     orientation: 'NS'|'EW',  — Ridge orientation
//     growthPhase: string,     — 'germination' | 'vegetative' | 'flowering' (optional, auto-derived from DAP)
//     leafWetnessHours: number, — Cumulative leaf wetness hours (optional)
//     gddThrips: number,       — Cumulative GDD for thrips (optional)
//     gddWhitefly: number,     — Cumulative GDD for whitefly (optional)
//     name: string,            — Human-readable structure name (for alert grouping)
//     id: string               — Unique identifier
//   }
//
// Input contract — weather object:
//   {
//     tempF: number,   — Current ambient temperature (°F)
//     rh: number,      — Current relative humidity (%)
//     windMph: number, — Current wind speed (mph)
//     windDir: number  — Wind direction (degrees, meteorological convention)
//   }
//
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Evaluates a single greenhouse structure against live weather and returns
 * a prioritized recommendation with all active alerts.
 *
 * @param {object} house — Structure config (see input contract above).
 * @param {object} weather — Current weather conditions.
 *
 * @returns {object|null} Recommendation result, or null if weather is missing.
 *   {
 *     houseId: string,
 *     houseName: string,
 *     estTemp: number,           — Estimated interior temp (°F)
 *     estNightTemp: number,
 *     estDayTemp: number,
 *     estRH: number,             — Estimated interior RH (%)
 *     vpd: number,               — Interior VPD (kPa)
 *     vpdAnalysis: object,       — Full getVPDStatus() result
 *     phase: string,             — Growth phase used for VPD evaluation
 *     gddThripsNow: object,      — Instantaneous thrips GDD contribution
 *     gddWhitflyNow: object,     — Instantaneous whitefly GDD contribution
 *     thermal: object,           — Full calculateThermalModifiers() result
 *     cropResult: object|null,   — Full calculateCropNeeds() result
 *     growthResult: object|null, — Full getGrowthStage() result
 *     windResult: object,        — Full calculateWindDynamics() result
 *     sqft: number,              — Floor area (ft²)
 *     priority: string,          — 'ok' | 'advisory' | 'warning' | 'critical'
 *     alerts: Array<{ level, icon, msg }>
 *   }
 */
export function getHouseRecommendation(house, weather) {

    // ── Guard: weather is required ──
    if (!weather || typeof weather.tempF !== 'number') return null;

    const wx = weather;

    // ── Resolve crop profiles ──
    //   The house.crops array should contain keys from CROP_PROFILES
    //   (e.g. 'solanaceous', 'coldHardyGreens'). If the caller uses
    //   UI checkbox values (e.g. 'greens'), they must map them before calling.
    const cropIds = (house.crops || []).filter(id => CROP_PROFILES[id]);
    const cropResult = cropIds.length > 0 ? calculateCropNeeds(cropIds) : null;

    // ── Growth stage from plant date ──
    const growthResult = house.plantDate ? getGrowthStage(house.plantDate) : null;

    // ── Wind dynamics from orientation ──
    const windResult = calculateWindDynamics(wx.windDir, house.orientation || 'NS');

    // ── Determine growth phase ──
    //   Priority: explicit house.growthPhase > auto-derived from DAP.
    //   If neither exists, default to 'vegetative' (safest middle-ground).
    let phase;
    if (house.growthPhase && GROWTH_PHASES.includes(house.growthPhase)) {
        phase = house.growthPhase;
    } else if (growthResult && growthResult.daysAfterPlanting >= 0) {
        const dap = growthResult.daysAfterPlanting;
        phase = dap < 14 ? 'germination' : dap < 40 ? 'vegetative' : 'flowering';
    } else {
        phase = 'vegetative';
    }

    // ── Time of day ──
    const hour = new Date().getHours();
    const isNight = hour >= 19 || hour < 7;

    // ── STEP 1: First-pass thermal estimate (dry conditions) ──
    //   We need estimated interior temperature to calculate VPD.
    //   VPD is then fed back into thermal modifiers for condensation check.
    const thermalDry = calculateThermalModifiers(
        house.width, house.length, house.glazing
    );
    const estDayTemp = Math.round(wx.tempF + thermalDry.dayTempDeltaF);
    const estNightTemp = Math.round(wx.tempF + thermalDry.nightTempDeltaF);
    const estTemp = isNight ? estNightTemp : estDayTemp;

    // ── STEP 2: Estimated interior RH ──
    //   Base: ambient RH + canopy transpiration contribution.
    //   Transpiration multiplier comes from getGrowthStage() and models
    //   LAI-driven water vapor contribution (2% seedling → 12% mature).
    const transpAdd = growthResult ? growthResult.transpirationMultiplier : 0;
    const estRH = Math.min(99, Math.round(wx.rh + transpAdd));

    // ── STEP 3: Interior VPD from estimated conditions ──
    const vpdPhysics = calculateVPD(estTemp, estRH);
    const vpd = vpdPhysics ? vpdPhysics.vpd_kPa : 0;
    const vpdAnalysis = getVPDStatus(vpd, phase);

    // ── STEP 4: Re-run thermal WITH VPD for condensation degradation ──
    //   If VPD < 0.43, water film forms on glazing → reduced solar gain.
    const thermal = calculateThermalModifiers(
        house.width, house.length, house.glazing, vpd
    );

    // ── STEP 5: Instantaneous GDD contributions ──
    const gddThripsNow = calculateGDD(estTemp, PEST_GDD_BASES.thrips);
    const gddWhitflyNow = calculateGDD(estTemp, PEST_GDD_BASES.whitefly);

    // ═══════════════════════════════════════════════════════════════════════
    //  PRIORITY GATE CASCADE
    // ═══════════════════════════════════════════════════════════════════════
    //
    //  All 9 gates are evaluated. No short-circuit — a structure can have
    //  multiple simultaneous alerts (e.g., wind warning + botrytis + frost).
    //  The overall priority is set to the highest severity encountered.

    const alerts = [];
    let priority = 'ok';

    /**
     * Helper to push an alert and escalate priority.
     * @param {'critical'|'warning'|'advisory'|'ok'} level
     * @param {string} icon — Emoji for field visibility
     * @param {string} msg — Human-readable, actionable instruction
     */
    function pushAlert(level, icon, msg) {
        alerts.push({ level, icon, msg });
        // Escalate priority (never de-escalate)
        if (level === 'critical') priority = 'critical';
        else if (level === 'warning' && priority !== 'critical') priority = 'warning';
        else if (level === 'advisory' && priority === 'ok') priority = 'advisory';
    }

    // ── GATE 1: WIND LOCKDOWN ─────────────────────────────────────────────
    //   > 30 mph: Universal lockdown regardless of wind-structure angle.
    //   > 22 mph broadside: Cross-wind on a sidewall = blowout risk on poly.
    //   > 22 mph parallel (Bernoulli): Safe — vacuum pulls OUT, not in.
    if (wx.windMph > 30) {
        pushAlert('critical', '🚨',
            `WIND LOCKDOWN: ${Math.round(wx.windMph)} mph — CLOSE ALL VENTS NOW. Structural damage risk.`
        );
    } else if (wx.windMph > 22 && !windResult.isBernoulliMode) {
        pushAlert('warning', '⚠️',
            `BROADSIDE WIND: ${Math.round(wx.windMph)} mph cross-wind. Open leeward vents only. Partial lockdown.`
        );
    }

    // ── GATE 2: CRITICAL PATHOGEN PURGE (Botrytis cinerea) ────────────────
    //   VPD < 0.20 kPa = free water on leaf surfaces.
    //   Botrytis sporulates in 2-4 hours under these conditions.
    //   Temp > 55°F required because Botrytis is inactive below ~50°F.
    //   Action: Open leeward + run heat to spike the temp differential,
    //   which raises SVP faster than AVP → widens VPD → breaks dew point.
    if (vpd < 0.20 && estTemp > 55) {
        pushAlert('critical', '🍄',
            `ACTIVE DEHUMIDIFICATION: VPD ${vpd.toFixed(2)} kPa — FREE WATER on leaves. ` +
            `Open Leeward 2 inches & RUN HEAT to spike VPD.`
        );
    }

    // ── GATE 3: MILDEW GUARD (Leaf Wetness Duration) ──────────────────────
    //   Downy and powdery mildew require sustained leaf wetness > 5 hours.
    //   This value comes from the data model (sensor or manual estimate).
    if (house.leafWetnessHours && house.leafWetnessHours > 5) {
        pushAlert('warning', '🌫️',
            `MILDEW RISK: Dew cycle exceeded ${house.leafWetnessHours} hrs (>5 hr threshold). ` +
            `Open vents 20% to break wetness.`
        );
    }

    // ── GATE 4: MITE EXPLOSION RISK ───────────────────────────────────────
    //   Two-spotted spider mite (Tetranychus urticae) reproduction rate
    //   peaks when: high temp (>85°F) + low humidity (VPD > 2.0 kPa).
    //   Drought-stressed leaves have reduced defensive jasmonic acid.
    if (estTemp > 85 && vpd > 2.0) {
        pushAlert('critical', '🕷️',
            `MITE RISK: ${estTemp}°F + VPD ${vpd.toFixed(2)} kPa. ` +
            `Drop temp and raise humidity. Do not let Two-Spotted Mites multiply.`
        );
    }

    // ── GATE 5: ENTOMOLOGICAL ALERT (GDD Thresholds) ──────────────────────
    //   Cumulative Growing Degree Days predict pest generation emergence.
    //   house.gddThrips / house.gddWhitefly are accumulated externally.
    //
    //   Thrips threshold:   415 GDD(°F) ≈ 231 GDD(°C) — 1st adult emergence
    //   Whitefly threshold: 222 GDD(°F) — egg-to-adult one full generation
    const houseThripsGDD = house.gddThrips || 0;
    const houseWhitflyGDD = house.gddWhitefly || 0;

    if (houseThripsGDD > PEST_GDD_THRESHOLDS.thrips) {
        pushAlert('warning', '🦟',
            `PEST EMERGENCE: Thrips GDD ${Math.round(houseThripsGDD)} > ` +
            `${PEST_GDD_THRESHOLDS.thrips} threshold. ` +
            `Deploy biological controls (e.g., Neoseiulus cucumeris).`
        );
    }
    if (houseWhitflyGDD > PEST_GDD_THRESHOLDS.whitefly) {
        pushAlert('warning', '🦟',
            `PEST EMERGENCE: Whitefly GDD ${Math.round(houseWhitflyGDD)} > ` +
            `${PEST_GDD_THRESHOLDS.whitefly} threshold. ` +
            `Deploy Encarsia formosa or sticky cards.`
        );
    }

    // ── GATE 6: COLD SHOCK / FROST ────────────────────────────────────────
    //   Night-mode only. Compares estimated interior night temp against
    //   the crop-specific night deadband floor.
    //   Heated structures: operator can run heat → critical alert.
    //   Unheated structures: only passive protection available → warning.
    if (cropResult && isNight) {
        const nightDb = cropResult.nightConflict ? null : cropResult.nightDeadband;
        if (nightDb && estNightTemp < nightDb.min) {
            if (house.heating === 'heated') {
                pushAlert('critical', '🔥',
                    `RUN HEAT: Est interior ${estNightTemp}°F < night floor ${nightDb.min}°F. ` +
                    `Crack vents 2" to purge moisture while heating.`
                );
            } else {
                pushAlert('warning', '❄️',
                    `FROST RISK: Unheated. Est ${estNightTemp}°F < ${nightDb.min}°F crop floor. ` +
                    `Deploy row cover or low tunnels.`
                );
            }
        }
    }

    // ── GATE 7: PRE-EMPTIVE COOLING (High Solar Gain) ─────────────────────
    //   Daytime only. Compares estimated interior temp against the crop
    //   deadband ceiling. If within 5°F of ceiling → advisory to pre-vent.
    if (!isNight && cropResult) {
        const db = cropResult.conflict ? cropResult.compromiseDeadband : cropResult.deadband;
        if (db && estDayTemp > db.max) {
            pushAlert('warning', '🌡️',
                `OVERHEATING: Est interior ${estDayTemp}°F > ${db.max}°F ceiling. ` +
                `Open both sidewalls if wind < 22 mph.`
            );
        } else if (db && estDayTemp >= db.max - 5) {
            pushAlert('advisory', '🌤️',
                `APPROACHING CEILING: Est ${estDayTemp}°F → ceiling ${db.max}°F. Pre-vent now.`
            );
        }
    }

    // ── GATE 8: DIRECTIONAL VENTING (Wind 10–22 mph) ──────────────────────
    //   Wind strong enough to matter for vent strategy, but not dangerous.
    //   Bernoulli mode: both sidewalls safe to open.
    //   Cross-wind mode: open leeward side first to prevent poly blowout.
    if (wx.windMph > 10 && wx.windMph <= 22) {
        if (windResult.isBernoulliMode) {
            pushAlert('advisory', '🌬️',
                `Wind ${Math.round(wx.windMph)} mph from ${windResult.windFrom}: ` +
                `Bernoulli vacuum active. Both sidewalls safe to open.`
            );
        } else {
            pushAlert('advisory', '🌬️',
                `Wind ${Math.round(wx.windMph)} mph cross-wind from ${windResult.windFrom}. ` +
                `Open leeward side first.`
            );
        }
    }

    // ── GATE 9: OPTIMAL DEADBAND (All Clear) ──────────────────────────────
    //   Only fires if no other gates produced any alerts.
    //   Summarizes the current nominal operating state.
    if (alerts.length === 0) {
        const dbLabel = cropResult
            ? `Deadband ${(cropResult.conflict ? cropResult.compromiseDeadband : cropResult.deadband).min}` +
            `–${(cropResult.conflict ? cropResult.compromiseDeadband : cropResult.deadband).max}°F`
            : 'No crops configured';
        pushAlert('ok', '✅',
            `All systems nominal. Est ${estTemp}°F / ${estRH}% RH / ` +
            `VPD ${vpd.toFixed(2)} kPa (${vpdAnalysis.status}). ${dbLabel}.`
        );
    }

    // ── Condensation warnings from thermal modifiers ──
    //   These are structural physics warnings (water film on glazing),
    //   appended after the gate cascade so they don't suppress Gate 9.
    if (thermal.warnings && thermal.warnings.length > 0) {
        thermal.warnings.forEach(w => pushAlert('warning', '💧', w));
    }

    return {
        houseId: house.id || '',
        houseName: house.name || 'Unnamed',
        estTemp, estNightTemp, estDayTemp, estRH,
        vpd, vpdAnalysis, phase,
        gddThripsNow, gddWhitflyNow,
        thermal, cropResult, growthResult, windResult,
        sqft: thermal.sqft,
        priority, alerts
    };
}


// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 8: FARM-LEVEL AGGREGATION — processFarmData
// ═══════════════════════════════════════════════════════════════════════════════
//
// Takes the full array of greenhouse structures and current weather, runs
// getHouseRecommendation on each, then aggregates the results into a
// farm-wide summary with deduplicated "masterAlerts."
//
// Master Alert Deduplication:
//
//   When multiple structures produce the SAME alert message, they are
//   merged into a single masterAlert with a list of affected houses.
//
//   Example:
//     House A → "WIND LOCKDOWN: 35 mph — CLOSE ALL VENTS NOW."
//     House B → "WIND LOCKDOWN: 35 mph — CLOSE ALL VENTS NOW."
//     ────────────────────────────────────────────────────────
//     masterAlert:
//       msg:    "WIND LOCKDOWN: 35 mph — CLOSE ALL VENTS NOW."
//       level:  "critical"
//       houses: ["House A", "House B"]
//       count:  2
//
//   This prevents alert fatigue when the same condition (e.g., wind)
//   affects every structure on the farm simultaneously.
//
// Farm-level statistics:
//   - Overall priority (highest across all structures)
//   - Average interior temperature and VPD
//   - Total square footage under management
//   - Count of structures by priority level
//   - Per-structure recommendation details
//
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Processes all greenhouse structures against current weather and returns
 * a farm-level summary with deduplicated masterAlerts.
 *
 * @param {object[]} housesArray — Array of house config objects.
 *   Each must conform to the getHouseRecommendation input contract.
 *
 * @param {object} weatherData — Current weather conditions.
 *   { tempF, rh, windMph, windDir }
 *
 * @returns {object} Farm-level aggregation:
 *   {
 *     timestamp: string,               — ISO 8601 evaluation time
 *     weather: object,                 — Echo of input weather
 *     overallPriority: string,         — Highest severity across all houses
 *     totalStructures: number,         — Count of structures evaluated
 *     totalSqft: number,              — Sum of all structure floor areas
 *     avgEstTemp: number,              — Mean estimated interior temp (°F)
 *     avgVPD: number,                  — Mean estimated interior VPD (kPa)
 *     priorityCounts: object,          — { critical, warning, advisory, ok }
 *     masterAlerts: Array<{            — Deduplicated alert groups
 *       msg: string,                   —   Alert message text
 *       level: string,                 —   Severity level
 *       icon: string,                  —   Emoji icon
 *       houses: string[],              —   Names of affected houses
 *       houseIds: string[],            —   IDs of affected houses
 *       count: number                  —   Number of affected structures
 *     }>,
 *     houseResults: object[]           — Per-structure recommendation details
 *   }
 */
export function processFarmData(housesArray, weatherData) {

    // ── Input validation ──
    if (!Array.isArray(housesArray) || housesArray.length === 0) {
        return {
            timestamp: new Date().toISOString(),
            weather: weatherData || null,
            overallPriority: 'ok',
            totalStructures: 0,
            totalSqft: 0,
            avgEstTemp: 0,
            avgVPD: 0,
            priorityCounts: { critical: 0, warning: 0, advisory: 0, ok: 0 },
            masterAlerts: [],
            houseResults: []
        };
    }
    if (!weatherData || typeof weatherData.tempF !== 'number') {
        return {
            timestamp: new Date().toISOString(),
            weather: null,
            overallPriority: 'ok',
            totalStructures: housesArray.length,
            totalSqft: 0,
            avgEstTemp: 0,
            avgVPD: 0,
            priorityCounts: { critical: 0, warning: 0, advisory: 0, ok: housesArray.length },
            masterAlerts: [{
                msg: 'Weather data unavailable. Cannot evaluate conditions.',
                level: 'advisory', icon: '⏳',
                houses: [], houseIds: [], count: 0
            }],
            houseResults: []
        };
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  PHASE 1: Run individual recommendations
    // ═══════════════════════════════════════════════════════════════════════
    //
    //  Each house is evaluated independently. The recommendation engine
    //  estimates interior conditions, calculates VPD, checks all 9 gates,
    //  and returns a prioritized alert list.

    const houseResults = [];

    for (const house of housesArray) {
        const rec = getHouseRecommendation(house, weatherData);
        if (rec) {
            houseResults.push(rec);
        }
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  PHASE 2: Aggregate farm-level statistics
    // ═══════════════════════════════════════════════════════════════════════

    // Priority hierarchy: critical > warning > advisory > ok
    const PRIORITY_RANK = { critical: 3, warning: 2, advisory: 1, ok: 0 };

    let overallPriority = 'ok';
    let totalSqft = 0;
    let sumTemp = 0;
    let sumVPD = 0;
    const priorityCounts = { critical: 0, warning: 0, advisory: 0, ok: 0 };

    for (const rec of houseResults) {
        // Escalate overall priority
        if ((PRIORITY_RANK[rec.priority] || 0) > (PRIORITY_RANK[overallPriority] || 0)) {
            overallPriority = rec.priority;
        }

        // Accumulate statistics
        totalSqft += rec.sqft || 0;
        sumTemp += rec.estTemp || 0;
        sumVPD += rec.vpd || 0;

        // Count by priority bucket
        if (priorityCounts[rec.priority] !== undefined) {
            priorityCounts[rec.priority]++;
        }
    }

    const count = houseResults.length || 1; // prevent division by zero
    const avgEstTemp = parseFloat((sumTemp / count).toFixed(1));
    const avgVPD = parseFloat((sumVPD / count).toFixed(4));

    // ═══════════════════════════════════════════════════════════════════════
    //  PHASE 3: Deduplicate alerts into masterAlerts
    // ═══════════════════════════════════════════════════════════════════════
    //
    //  Two alerts are "identical" if they share the same message text.
    //  This collapses farm-wide conditions (wind, frost) into single
    //  entries with a list of affected structures.
    //
    //  Implementation:
    //    Use a Map keyed by alert.msg. For each alert from each house,
    //    either create a new entry or append the house to an existing one.
    //    Preserve the highest severity level if two identical messages
    //    somehow arrive at different severity levels (shouldn't happen,
    //    but defensive coding prevents silent data loss).

    /** @type {Map<string, { msg: string, level: string, icon: string, houses: string[], houseIds: string[] }>} */
    const alertMap = new Map();

    for (const rec of houseResults) {
        for (const alert of rec.alerts) {
            const key = alert.msg;

            if (alertMap.has(key)) {
                // ── Existing alert: append this house ──
                const existing = alertMap.get(key);
                existing.houses.push(rec.houseName);
                existing.houseIds.push(rec.houseId);

                // Escalate level if this instance is higher severity
                if ((PRIORITY_RANK[alert.level] || 0) > (PRIORITY_RANK[existing.level] || 0)) {
                    existing.level = alert.level;
                }
            } else {
                // ── New alert: create entry ──
                alertMap.set(key, {
                    msg: alert.msg,
                    level: alert.level,
                    icon: alert.icon,
                    houses: [rec.houseName],
                    houseIds: [rec.houseId]
                });
            }
        }
    }

    // ── Convert Map to sorted array ──
    //   Sort by: severity (critical first) → then by number of affected houses
    const masterAlerts = Array.from(alertMap.values())
        .map(entry => ({
            ...entry,
            count: entry.houses.length
        }))
        .sort((a, b) => {
            // Primary sort: severity (highest first)
            const sevDiff = (PRIORITY_RANK[b.level] || 0) - (PRIORITY_RANK[a.level] || 0);
            if (sevDiff !== 0) return sevDiff;
            // Secondary sort: more affected houses first
            return b.count - a.count;
        });

    // ═══════════════════════════════════════════════════════════════════════
    //  PHASE 4: Assemble and return farm summary
    // ═══════════════════════════════════════════════════════════════════════

    return {
        timestamp: new Date().toISOString(),
        weather: weatherData,
        overallPriority,
        totalStructures: houseResults.length,
        totalSqft,
        avgEstTemp,
        avgVPD,
        priorityCounts,
        masterAlerts,
        houseResults
    };
}


// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 9: FIREBASE CONFIGURATION & INITIALIZATION
// ═══════════════════════════════════════════════════════════════════════════════
//
// Firebase v8 CDN SDK initialization for the Greenhouse OS B2B SaaS layer.
//
// In the single-file HTML deployment, include these CDN scripts in <head>
// BEFORE the <script> block that contains this engine:
//
//   <script src="https://www.gstatic.com/firebasejs/8.10.1/firebase-app.js"></script>
//   <script src="https://www.gstatic.com/firebasejs/8.10.1/firebase-auth.js"></script>
//   <script src="https://www.gstatic.com/firebasejs/8.10.1/firebase-firestore.js"></script>
//
// The firebaseConfig object below is a placeholder. Replace with your own
// Firebase project credentials from the Firebase Console:
//   → Project Settings → General → Your Apps → Firebase SDK snippet → Config
//
// SECURITY NOTE:
//   These keys are safe to expose in client-side code. Firebase Security Rules
//   on Firestore are the actual access control mechanism, not these keys.
//   Never rely on client-side key secrecy for data protection.
//
// ═══════════════════════════════════════════════════════════════════════════════

// ── Production Logging Guard ────────────────────────────────────────────────
//
// Set DEV_MODE = false before any public deployment.
// When false, all styled console.log status messages are suppressed.
// console.error and console.warn for actual failures remain active always.
//
const DEV_MODE = false;
const devLog = (...args) => { if (DEV_MODE) console.log(...args); };

/**
 * Firebase project configuration.
 * Replace this placeholder with your actual Firebase project keys.
 */
export const firebaseConfig = {
    apiKey:            'AIzaSyBDUYNeXubia-Lw3AxTkwVEJb7onBRpRHk',
    authDomain:        'greenhouse-os.firebaseapp.com',
    projectId:         'greenhouse-os',
    storageBucket:     'greenhouse-os.firebasestorage.app',
    messagingSenderId: '532776840833',
    appId:             '1:532776840833:web:e8256cfc93566765e42780'
};

/**
 * Firebase service references.
 * These are initialized by initFirebase() and used throughout the auth
 * and sync subsystems. They are null until initialization completes.
 *
 * Usage pattern:
 *   initFirebase();  // call once at boot
 *   // auth, db are now live references
 */
let firebaseApp = null;
let auth = null;
let db = null;

/**
 * Initializes Firebase App, Auth, and Firestore services.
 *
 * Call this ONCE at application boot, after the Firebase CDN scripts
 * have loaded. Subsequent calls are no-ops (idempotent).
 *
 * @returns {{ app: object, auth: object, db: object }} Firebase service refs
 * @throws {Error} If firebase global is not available (CDN not loaded)
 */
export function initFirebase() {
    // Guard: already initialized
    if (firebaseApp) {
        return { app: firebaseApp, auth, db };
    }

    // Guard: Firebase SDK must be loaded via CDN before this runs
    if (typeof firebase === 'undefined') {
        throw new Error(
            'initFirebase(): Firebase SDK not found. ' +
            'Include the Firebase v8 CDN scripts in your HTML <head> before this script.'
        );
    }

    // Prevent double-initialization if another script already called firebase.initializeApp
    if (!firebase.apps.length) {
        firebaseApp = firebase.initializeApp(firebaseConfig);
    } else {
        firebaseApp = firebase.apps[0];
    }

    auth = firebase.auth();
    db = firebase.firestore();

    // ── Firestore settings ──
    //   Enable offline persistence so the app works without connectivity.
    //   This is CRITICAL for farm environments with intermittent cellular/WiFi.
    //   Firestore queues writes locally and syncs when connectivity returns.
    db.enablePersistence({ synchronizeTabs: true }).catch(err => {
        if (err.code === 'failed-precondition') {
            // Multiple tabs open — persistence can only be enabled in one tab.
            console.warn(
                '[firebase] Offline persistence failed: multiple tabs open. ' +
                'Only one tab can use persistence at a time.'
            );
        } else if (err.code === 'unimplemented') {
            // Browser doesn't support persistence (rare, but possible)
            console.warn('[firebase] Offline persistence not supported in this browser.');
        }
    });

    devLog(
        '%c 🔥 Firebase Initialized — Auth + Firestore ready ',
        'background:#1a73e8;color:white;font-size:11px;font-weight:bold;' +
        'padding:3px 8px;border-radius:3px;'
    );

    return { app: firebaseApp, auth, db };
}


// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 10: APPLICATION STATE — B2B SaaS SCHEMA
// ═══════════════════════════════════════════════════════════════════════════════
//
// The central state atom for the Greenhouse OS application. All UI rendering,
// cloud sync, and physics engine calls read from and write to this object.
//
// State shape:
//
//   state.user          — Firebase Auth user object (null if logged out)
//   state.isReadOnly    — True if subscription is expired. When true:
//                          - All write operations are blocked (CRUD, sync)
//                          - CSV export ALWAYS works (Data Bill of Rights)
//                          - UI shows "read-only" indicators
//                          - User can still VIEW their data, just not modify it
//   state.globalSettings — Farm-level configuration
//     .lat / .lon       — Farm coordinates for Open-Meteo weather fetch
//     .climateProfile   — USDA zone classification for physics engine defaults
//     .apiKeys          — Third-party API keys (Open-Meteo is free, but
//                         future integrations like Davis Instruments or
//                         Orbit B-hyve may need keys stored here)
//   state.houses[]      — Array of greenhouse structure objects (v13 schema)
//                         Each house contains crops, tasks, irrigation logs,
//                         soil tests, GDD accumulators, and leaf wetness data
//
// Subscription Status Model:
//
//   Stored in Firestore at: users/${uid}/subscription_status
//   Valid values:
//     'active'    → Full read/write access
//     'trial'     → Full access during trial period (treated as active)
//     'expired'   → Read-only mode + CSV export + renewal prompt
//     'cancelled' → Same as expired (grace period may apply)
//
//   The subscription check happens in onAuthStateChanged. If the status
//   is 'expired' or 'cancelled', state.isReadOnly is set to true.
//   This is a CLIENT-SIDE check — always enforce access control in
//   Firestore Security Rules as well.
//
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Central application state atom.
 * This is the single source of truth for the entire Greenhouse OS application.
 */
export const state = {
    // ── Authentication ──
    user: null,             // Firebase Auth user object or null
    isReadOnly: false,      // True when subscription expired — blocks writes

    // ── Farm-Level Configuration ──
    globalSettings: {
        // Nobleboro, Maine — default farm coordinates (Zone 5b)
        lat: 44.0784,
        lon: -69.4892,

        // Climate profile — selects from the 10 U.S. CLIMATE_PROFILES.
        // Drives frost probability models, solar irradiance defaults,
        // dominant pest pressure, and structural load recommendations.
        // See Section 14 (CLIMATE_PROFILES) for the full data dictionary.
        //
        // Valid values:
        //   'arctic_cryosphere'     — Alaska / extreme north (USDA 1-3)
        //   'boreal_continental'    — Upper Midwest / northern Plains (3-4)
        //   'cold_humid_interior'   — New England / Great Lakes (4-6)
        //   'high_altitude_arid'    — Rockies / Intermountain West (4-6)
        //   'cloudy_marine'         — Pacific NW / coastal WA-OR (7-9)
        //   'humid_temperate'       — Mid-Atlantic / Ohio Valley (6-7)
        //   'mixed_humid_south'     — Upper South / Piedmont (7-8)
        //   'coastal_med'           — California Mediterranean (9-11)
        //   'hot_arid_desert'       — Desert SW / AZ-NV-NM (9-13)
        //   'subtropical'           — Gulf Coast / FL / Deep South (8-11)
        climateProfile: 'cold_humid_interior',

        // Third-party API keys (user-provided, stored in Firestore)
        apiKeys: {}
    },

    // ── Greenhouse Structures ──
    // Array of house objects conforming to the v14 schema.
    // Each house contains:
    //
    //   Core identity:
    //     id, name, group, orientation
    //
    //   Physical structure:
    //     width (ft), length (ft), glazing ('single'|'double'), heating ('heated'|'unheated')
    //
    //   Crop configuration:
    //     crops[]         — Array of CROP_PROFILES keys (e.g. ['solanaceous', 'coldHardyGreens'])
    //     cropType        — Photosynthetic pathway: 'c3_fruiting' | 'c3_leafy' | 'cam_succulent'
    //                       Drives CO₂ response curves, light saturation points, and
    //                       water-use efficiency calculations. See Section 15.
    //     plantDate       — ISO 8601 planting date
    //     growthPhase     — 'germination' | 'vegetative' | 'flowering'
    //
    //   Sensor integration:
    //     sensorConfig: {
    //       brand:    string,   — Sensor manufacturer ('davis', 'ecowitt', 'sensecap', 'none')
    //       deviceId: string    — Hardware device ID for API pairing
    //     }
    //
    //   Operational logs:
    //     tasks[], irrigationLogs[], soilTests[], notes
    //
    //   Pest & pathology accumulators:
    //     leafWetnessHours, gddThrips, gddWhitefly
    houses: []
};


// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 11: AUTHENTICATION — LOGIN, LOGOUT, STATE OBSERVER
// ═══════════════════════════════════════════════════════════════════════════════
//
// Firebase Auth integration with email/password authentication.
//
// Authentication flow:
//
//   1. User calls loginUser(email, password)
//   2. Firebase Auth validates credentials → returns user object
//   3. onAuthStateChanged fires → fetches user doc from Firestore
//   4. User doc contains subscription_status, globalSettings, houses[]
//   5. State is hydrated from Firestore data
//   6. If subscription_status === 'expired', state.isReadOnly = true
//   7. UI re-renders with the user's farm data
//
// Logout flow:
//
//   1. User calls logoutUser()
//   2. Firebase Auth signs out → clears session
//   3. onAuthStateChanged fires with null user
//   4. State is reset to defaults
//   5. UI re-renders to login screen
//
// Security model:
//   - Authentication is handled entirely by Firebase Auth
//   - Client-side isReadOnly is a UX convenience, not a security boundary
//   - Real access control MUST be enforced in Firestore Security Rules:
//
//     rules_version = '2';
//     service cloud.firestore {
//       match /databases/{database}/documents {
//         match /users/{userId} {
//           allow read: if request.auth != null && request.auth.uid == userId;
//           allow write: if request.auth != null && request.auth.uid == userId
//                        && get(/databases/$(database)/documents/users/$(userId))
//                           .data.subscription_status in ['active', 'trial'];
//         }
//       }
//     }
//
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Sign in with email and password.
 *
 * @param {string} email — User's email address.
 * @param {string} password — User's password.
 *
 * @returns {Promise<firebase.User>} The authenticated user object.
 *
 * @throws {Error} If Firebase Auth is not initialized, or if
 *   authentication fails (invalid credentials, network error, etc.)
 *
 * @example
 *   try {
 *     const user = await loginUser('grower@example.com', 'S3cur3P@ss');
 *     devLog('Logged in as:', user.email);
 *   } catch (err) {
 *     console.error('Login failed:', err.message);
 *   }
 */
export async function loginUser(email, password) {
    if (!auth) {
        throw new Error(
            'loginUser(): Firebase Auth not initialized. Call initFirebase() first.'
        );
    }

    // ── Input validation ──
    if (!email || typeof email !== 'string' || !email.includes('@')) {
        return { success: false, user: null, error: 'A valid email address is required.' };
    }
    if (!password || typeof password !== 'string' || password.length < 6) {
        return { success: false, user: null, error: 'Password must be at least 6 characters.' };
    }

    try {
        const credential = await auth.signInWithEmailAndPassword(email, password);

        devLog(
            `%c ✅ Authenticated: ${credential.user.email} `,
            'background:#16a34a;color:white;font-size:11px;font-weight:bold;' +
            'padding:3px 8px;border-radius:3px;'
        );

        // The actual state hydration happens in onAuthStateChanged,
        // which fires automatically after signIn completes.
        // Return a { success, user } object so the UI layer can check result.success
        // without needing a try/catch wrapper.
        return { success: true, user: credential.user, error: null };

    } catch (error) {
        // Map Firebase error codes to human-readable field messages
        const friendlyMessages = {
            'auth/user-not-found':
                'No account found with this email. Check your spelling or create a new account.',
            'auth/wrong-password':
                'Incorrect password. Please try again.',
            'auth/invalid-credential':
                'Incorrect email or password. Please try again.',
            'auth/invalid-email':
                'The email address format is invalid.',
            'auth/user-disabled':
                'This account has been disabled. Contact support@practicalfarmtools.com.',
            'auth/too-many-requests':
                'Too many failed attempts. Please wait a few minutes before trying again.',
            'auth/network-request-failed':
                'Network error. Check your internet connection and try again.'
        };

        const message = friendlyMessages[error.code] || error.message;
        console.error(`[auth] Login failed (${error.code}):`, message);
        // Return { success: false } instead of throwing — UI checks result.success
        return { success: false, user: null, error: message };
    }
}


/**
 * Sign out the current user and reset application state.
 *
 * @returns {Promise<void>}
 *
 * @throws {Error} If Firebase Auth is not initialized.
 *
 * @example
 *   await logoutUser();
 *   // state.user is now null, state.houses is empty
 */
export async function logoutUser() {
    if (!auth) {
        throw new Error(
            'logoutUser(): Firebase Auth not initialized. Call initFirebase() first.'
        );
    }

    try {
        await auth.signOut();

        devLog(
            '%c 🚪 Signed out ',
            'background:#64748b;color:white;font-size:11px;font-weight:bold;' +
            'padding:3px 8px;border-radius:3px;'
        );

        // State reset happens in onAuthStateChanged (fires with null user)

    } catch (error) {
        console.error('[auth] Logout failed:', error.message);
        throw error;
    }
}


/**
 * Registers the Firebase onAuthStateChanged observer.
 *
 * This is the CENTRAL NERVOUS SYSTEM of the auth flow. It fires:
 *   1. On page load (checks existing session)
 *   2. After loginUser() completes
 *   3. After logoutUser() completes
 *   4. When the session expires or is revoked
 *
 * When a user is authenticated:
 *   - Fetches their document from Firestore (users/${uid})
 *   - Checks subscription_status for read-only gating
 *   - Hydrates state.globalSettings and state.houses from cloud data
 *   - Falls back to localStorage if Firestore fetch fails (offline mode)
 *
 * When no user is authenticated:
 *   - Resets state to defaults
 *   - Clears houses array
 *
 * @param {function} onReady — Callback invoked after state is fully
 *   hydrated (or reset). Receives the state object.
 *   Use this to trigger UI re-renders.
 *
 * @returns {function} Unsubscribe function to detach the observer.
 *
 * @example
 *   const unsubscribe = setupAuthObserver((currentState) => {
 *     if (currentState.user) {
 *       renderDashboard(currentState);
 *     } else {
 *       renderLoginScreen();
 *     }
 *   });
 */
export function setupAuthObserver(onReady) {
    if (!auth) {
        throw new Error(
            'setupAuthObserver(): Firebase Auth not initialized. Call initFirebase() first.'
        );
    }

    const unsubscribe = auth.onAuthStateChanged(async (user) => {
        if (user) {
            // ═══════════════════════════════════════════════════════════
            //  USER IS AUTHENTICATED
            // ═══════════════════════════════════════════════════════════

            state.user = user;

            devLog(
                `%c 👤 Auth state: ${user.email} (uid: ${user.uid}) `,
                'background:#1e40af;color:white;font-size:11px;font-weight:bold;' +
                'padding:3px 8px;border-radius:3px;'
            );

            try {
                // ── Fetch user document from Firestore ──
                //   Document path: users/${uid}
                //   Expected fields:
                //     subscription_status: 'active' | 'trial' | 'expired' | 'cancelled'
                //     globalSettings: { lat, lon, climateProfile, apiKeys }
                //     houses: [ ... v13 house objects ... ]
                //     last_sync: Firestore Timestamp

                const userDocRef = db.collection('users').doc(user.uid);
                const userDoc = await userDocRef.get();

                if (userDoc.exists) {
                    const data = userDoc.data();

                    // ── Subscription gating ──
                    //   If subscription is expired, the user can still VIEW
                    //   their data and export CSV (Data Bill of Rights), but
                    //   all write operations are blocked at the UI level.
                    //   Server-side enforcement is in Firestore Security Rules.
                    const subStatus = data.subscription_status || 'active';
                    state.isReadOnly = (subStatus === 'expired' || subStatus === 'cancelled');

                    if (state.isReadOnly) {
                        console.warn(
                            `%c ⚠️ Subscription ${subStatus} — READ-ONLY MODE ` +
                            '(Data export always available)',
                            'background:#d97706;color:white;font-size:11px;font-weight:bold;' +
                            'padding:3px 8px;border-radius:3px;'
                        );
                    }

                    // ── Hydrate state from Firestore data ──
                    if (data.globalSettings) {
                        state.globalSettings = {
                            lat: data.globalSettings.lat ?? 44.0784,
                            lon: data.globalSettings.lon ?? -69.4892,
                            climateProfile: data.globalSettings.climateProfile || 'cold_humid_interior',
                            apiKeys: data.globalSettings.apiKeys || {}
                        };
                    }

                    if (Array.isArray(data.houses)) {
                        state.houses = data.houses;
                    }

                    devLog(
                        `[auth] Loaded ${state.houses.length} structures from Firestore. ` +
                        `Subscription: ${subStatus}.`
                    );

                } else {
                    // ── New user: no Firestore document yet ──
                    //   This happens on first login after account creation.
                    //   We create a skeleton document with defaults so the user
                    //   has something to build on.

                    devLog('[auth] New user — creating initial Firestore document.');

                    state.isReadOnly = false;
                    state.houses = [];

                    await userDocRef.set({
                        email: user.email,
                        subscription_status: 'trial',
                        globalSettings: state.globalSettings,
                        houses: [],
                        created_at: firebase.firestore.FieldValue.serverTimestamp(),
                        last_sync: firebase.firestore.FieldValue.serverTimestamp()
                    });
                }

            } catch (error) {
                // ── Firestore fetch failed (offline / permissions) ──
                //   Fall back to whatever is in state already.
                //   With Firestore persistence enabled, this should be rare —
                //   the SDK serves cached data when offline.
                console.warn(
                    '[auth] Firestore fetch failed — using cached/default state.',
                    error.message
                );
                state.isReadOnly = false; // Fail open for offline use
            }

        } else {
            // ═══════════════════════════════════════════════════════════
            //  NO USER — SIGNED OUT
            // ═══════════════════════════════════════════════════════════

            state.user = null;
            state.isReadOnly = false;
            state.houses = [];
            state.globalSettings = {
                lat: 44.0784,
                lon: -69.4892,
                climateProfile: 'cold_humid_interior',
                apiKeys: {}
            };

            devLog(
                '%c 👤 Auth state: signed out ',
                'background:#94a3b8;color:white;font-size:11px;font-weight:bold;' +
                'padding:3px 8px;border-radius:3px;'
            );
        }

        // ── Notify the UI layer ──
        if (typeof onReady === 'function') {
            onReady(state);
        }
    });

    return unsubscribe;
}


// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 12: CLOUD SYNC — FIRESTORE WRITE
// ═══════════════════════════════════════════════════════════════════════════════
//
// Securely saves the current application state to Firestore.
//
// Firestore document structure (users/${uid}):
//
//   {
//     email:                string,
//     subscription_status:  'active' | 'trial' | 'expired' | 'cancelled',
//     globalSettings: {
//       lat:              number,
//       lon:              number,
//       climateProfile:   string,
//       apiKeys:          object
//     },
//     houses: [
//       {
//         id, name, group, orientation, plantDate, crops[], width, length,
//         glazing, heating, notes, tasks[], irrigationLogs[], soilTests[],
//         growthPhase, leafWetnessHours, gddThrips, gddWhitefly
//       },
//       ...
//     ],
//     last_sync:           Firestore Timestamp
//   }
//
// Security considerations:
//   - User can only write to their own document (uid match in Security Rules)
//   - Expired subscriptions cannot write (Security Rules + client-side check)
//   - Firestore offline persistence queues writes during connectivity loss
//   - merge: true prevents overwriting fields not included in the write
//
// Call frequency:
//   - After any CRUD operation (add/edit/delete house, log irrigation, etc.)
//   - On a 30-second debounce timer during active editing sessions
//   - Before logout (final sync)
//   - NOT after every weather fetch (that's read-only data)
//
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Saves the current application state to Firestore.
 *
 * @param {object} currentState — The state object to sync. Must contain
 *   .user (Firebase Auth user), .globalSettings, and .houses[].
 *
 * @returns {Promise<boolean>} True if sync succeeded, false if blocked or failed.
 *
 * @example
 *   const success = await syncFarmToCloud(state);
 *   if (success) {
 *     showToast('Saved to cloud ☁️');
 *   }
 */
export async function syncFarmToCloud(currentState) {

    // ── Guard: must be authenticated ──
    if (!currentState.user) {
        console.warn('[sync] Cannot sync — no authenticated user.');
        return false;
    }

    // ── Guard: must not be read-only ──
    if (currentState.isReadOnly) {
        console.warn(
            '[sync] Cannot sync — subscription expired (read-only mode). ' +
            'Renew your subscription to resume cloud sync.'
        );
        return false;
    }

    // ── Guard: Firestore must be initialized ──
    if (!db) {
        console.warn('[sync] Cannot sync — Firestore not initialized.');
        return false;
    }

    const uid = currentState.user.uid;

    try {
        // ── Sanitize houses before write ──
        //   Firestore rejects undefined values. We strip them and ensure
        //   all houses conform to the v14 schema.
        //   Also strip any DOM-only or transient properties.
        const sanitizedHouses = (currentState.houses || []).map(h => ({
            id:               h.id || '',
            name:             h.name || 'Unnamed Structure',
            group:            h.group || '',
            orientation:      h.orientation || 'NS',
            plantDate:        h.plantDate || '',
            crops:            Array.isArray(h.crops) ? h.crops : [],
            cropType:         h.cropType || 'c3_fruiting',
            width:            h.width || 30,
            length:           h.length || 96,
            glazing:          h.glazing || 'single',
            heating:          h.heating || 'unheated',
            notes:            h.notes || '',
            sensorConfig: {
                brand:    (h.sensorConfig && h.sensorConfig.brand) || 'none',
                deviceId: (h.sensorConfig && h.sensorConfig.deviceId) || ''
            },
            tasks:            Array.isArray(h.tasks) ? h.tasks : [],
            irrigationLogs:   Array.isArray(h.irrigationLogs) ? h.irrigationLogs : [],
            soilTests:        Array.isArray(h.soilTests) ? h.soilTests : [],
            growthPhase:      h.growthPhase || 'vegetative',
            leafWetnessHours: h.leafWetnessHours || 0,
            gddThrips:        h.gddThrips || 0,
            gddWhitefly:      h.gddWhitefly || 0
        }));

        // ── Write to Firestore ──
        //   merge: true ensures we don't overwrite subscription_status
        //   or other server-managed fields (e.g., created_at, billing_info).
        await db.collection('users').doc(uid).set({
            globalSettings: {
                lat:            currentState.globalSettings.lat ?? 44.0784,
                lon:            currentState.globalSettings.lon ?? -69.4892,
                climateProfile: currentState.globalSettings.climateProfile || 'cold_humid_interior',
                apiKeys:        currentState.globalSettings.apiKeys || {}
            },
            houses: sanitizedHouses,
            last_sync: firebase.firestore.FieldValue.serverTimestamp()
        }, { merge: true });

        devLog(
            `%c ☁️ Synced ${sanitizedHouses.length} structures to Firestore `,
            'background:#1a73e8;color:white;font-size:11px;font-weight:bold;' +
            'padding:3px 8px;border-radius:3px;'
        );

        return true;

    } catch (error) {
        console.error('[sync] Firestore write failed:', error.message);

        // If the write failed due to permissions, the user's subscription
        // may have been revoked server-side. Update local state.
        if (error.code === 'permission-denied') {
            console.warn(
                '[sync] Permission denied — server may have revoked write access. ' +
                'Setting local state to read-only.'
            );
            currentState.isReadOnly = true;
        }

        return false;
    }
}


// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 13: DATA BILL OF RIGHTS — CSV EXPORT
// ═══════════════════════════════════════════════════════════════════════════════
//
// The "Data Bill of Rights" is a core Practical Farm Tools principle:
//
//   YOUR DATA IS YOUR DATA.
//   You can ALWAYS export everything, even if your subscription has expired.
//   We will NEVER hold your farm data hostage.
//
// This function generates a comprehensive CSV archive of ALL user data:
//   - Global farm settings (coordinates, climate profile)
//   - Every greenhouse structure and its configuration
//   - All task lists (with completion status)
//   - All irrigation logs (with timestamps)
//   - All soil test records (with pH and notes)
//   - GDD pest accumulators and leaf wetness data
//
// The CSV is formatted for import into:
//   - Microsoft Excel / Google Sheets
//   - LibreOffice Calc
//   - Any farm management system that accepts CSV
//   - Backup archival systems
//
// This function triggers an immediate browser file download.
// No server roundtrip, no API call, no subscription check.
//
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Escapes a value for safe CSV inclusion.
 * Wraps in double quotes if the value contains commas, quotes, or newlines.
 * Doubles any existing double quotes per RFC 4180.
 *
 * @param {*} value — The value to escape. Coerced to string.
 * @returns {string} CSV-safe string
 */
function csvEscape(value) {
    if (value === null || value === undefined) return '';
    const str = String(value);
    if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
        return '"' + str.replace(/"/g, '""') + '"';
    }
    return str;
}

/**
 * Exports the entire farm data set to a clean CSV file and triggers
 * a browser download.
 *
 * THIS FUNCTION ALWAYS WORKS — even in read-only mode.
 * The Data Bill of Rights guarantees farmers can always access their data.
 *
 * @param {object} currentState — The application state to export.
 *   Must contain .globalSettings and .houses[].
 *
 * @returns {string} The generated CSV string (also triggers download).
 *
 * @example
 *   // Called from a "Download My Data" button — always available
 *   exportFarmDataToCSV(state);
 */
export function exportFarmDataToCSV(currentState) {

    const lines = [];
    const timestamp = new Date().toISOString();

    // ═══════════════════════════════════════════════════════════════════
    //  SECTION A: HEADER & METADATA
    // ═══════════════════════════════════════════════════════════════════

    lines.push('# Practical Farm Tools — Greenhouse OS Data Archive');
    lines.push(`# Generated: ${timestamp}`);
    lines.push(`# Account: ${currentState.user ? currentState.user.email : 'Local (not signed in)'}`);
    lines.push(`# Subscription: ${currentState.isReadOnly ? 'Expired (Read-Only)' : 'Active'}`);
    lines.push('# This file is YOUR data. Import it anywhere you need.');
    lines.push('');

    // ═══════════════════════════════════════════════════════════════════
    //  SECTION B: GLOBAL FARM SETTINGS
    // ═══════════════════════════════════════════════════════════════════

    lines.push('## FARM SETTINGS');
    lines.push('Setting,Value');

    const gs = currentState.globalSettings || {};
    lines.push(`Latitude,${csvEscape(gs.lat)}`);
    lines.push(`Longitude,${csvEscape(gs.lon)}`);
    lines.push(`Climate Profile,${csvEscape(gs.climateProfile)}`);
    lines.push(`Total Structures,${(currentState.houses || []).length}`);
    lines.push('');

    // ═══════════════════════════════════════════════════════════════════
    //  SECTION C: GREENHOUSE STRUCTURES
    // ═══════════════════════════════════════════════════════════════════

    const houses = currentState.houses || [];

    lines.push('## GREENHOUSE STRUCTURES');
    lines.push([
        'Structure ID', 'Name', 'Group', 'Orientation',
        'Width (ft)', 'Length (ft)', 'Area (sqft)',
        'Glazing', 'Heating', 'Plant Date', 'Growth Phase',
        'Crop Type', 'Crops', 'Sensor Brand', 'Sensor Device ID',
        'Leaf Wetness (hrs)', 'GDD Thrips', 'GDD Whitefly', 'Notes'
    ].join(','));

    for (const h of houses) {
        const sqft = (h.width || 30) * (h.length || 96);
        const cropsStr = Array.isArray(h.crops) ? h.crops.join('; ') : '';
        const sensor = h.sensorConfig || {};

        lines.push([
            csvEscape(h.id),
            csvEscape(h.name),
            csvEscape(h.group),
            csvEscape(h.orientation),
            h.width || 30,
            h.length || 96,
            sqft,
            csvEscape(h.glazing),
            csvEscape(h.heating),
            csvEscape(h.plantDate),
            csvEscape(h.growthPhase),
            csvEscape(h.cropType || 'c3_fruiting'),
            csvEscape(cropsStr),
            csvEscape(sensor.brand || 'none'),
            csvEscape(sensor.deviceId || ''),
            h.leafWetnessHours || 0,
            h.gddThrips || 0,
            h.gddWhitefly || 0,
            csvEscape(h.notes)
        ].join(','));
    }
    lines.push('');

    // ═══════════════════════════════════════════════════════════════════
    //  SECTION D: TASK LISTS (per structure)
    // ═══════════════════════════════════════════════════════════════════

    lines.push('## TASKS');
    lines.push('Structure,Task ID,Task Text,Completed');

    for (const h of houses) {
        const tasks = h.tasks || [];
        for (const t of tasks) {
            lines.push([
                csvEscape(h.name),
                csvEscape(t.id),
                csvEscape(t.text),
                t.done ? 'Yes' : 'No'
            ].join(','));
        }
    }
    lines.push('');

    // ═══════════════════════════════════════════════════════════════════
    //  SECTION E: IRRIGATION LOGS (per structure)
    // ═══════════════════════════════════════════════════════════════════

    lines.push('## IRRIGATION LOGS');
    lines.push('Structure,Log ID,Minutes,Notes,Timestamp');

    for (const h of houses) {
        const logs = h.irrigationLogs || [];
        for (const l of logs) {
            lines.push([
                csvEscape(h.name),
                csvEscape(l.id),
                l.minutes || 0,
                csvEscape(l.notes),
                csvEscape(l.timestamp)
            ].join(','));
        }
    }
    lines.push('');

    // ═══════════════════════════════════════════════════════════════════
    //  SECTION F: SOIL TEST RECORDS (per structure)
    // ═══════════════════════════════════════════════════════════════════

    lines.push('## SOIL TESTS');
    lines.push('Structure,Test ID,Date,pH,Notes,Timestamp');

    for (const h of houses) {
        const tests = h.soilTests || [];
        for (const t of tests) {
            lines.push([
                csvEscape(h.name),
                csvEscape(t.id),
                csvEscape(t.date),
                t.ph || '',
                csvEscape(t.notes),
                csvEscape(t.timestamp)
            ].join(','));
        }
    }
    lines.push('');
    lines.push('# END OF ARCHIVE');

    // ── Assemble the CSV ──
    const csvContent = lines.join('\n');

    // ═══════════════════════════════════════════════════════════════════
    //  TRIGGER BROWSER DOWNLOAD
    // ═══════════════════════════════════════════════════════════════════
    //
    //   Creates a Blob, generates an object URL, programmatically clicks
    //   an anchor element to trigger the download, then cleans up.
    //   This is the standard browser-side file-save pattern.
    //   Works in all modern browsers (Chrome, Firefox, Safari, Edge).
    //   No server roundtrip required.

    try {
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);

        const link = document.createElement('a');
        link.setAttribute('href', url);
        link.setAttribute('download', 'PracticalFarmTools_Archive.csv');
        link.style.display = 'none';

        document.body.appendChild(link);
        link.click();

        // Cleanup: revoke the object URL and remove the temp anchor
        // Use setTimeout to ensure the download has started before cleanup
        setTimeout(() => {
            document.body.removeChild(link);
            URL.revokeObjectURL(url);
        }, 100);

        devLog(
            `%c 📦 Data exported: PracticalFarmTools_Archive.csv ` +
            `(${houses.length} structures, ${csvContent.length} bytes) `,
            'background:#16a34a;color:white;font-size:11px;font-weight:bold;' +
            'padding:3px 8px;border-radius:3px;'
        );

    } catch (error) {
        // If browser download fails (e.g., in a headless environment),
        // the CSV string is still returned for programmatic use.
        console.error('[export] Browser download failed:', error.message);
        devLog('[export] CSV content returned as string — use programmatically.');
    }

    return csvContent;
}


// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 14: U.S. CLIMATE PROFILES — 10-ZONE DATA DICTIONARY
// ═══════════════════════════════════════════════════════════════════════════════
//
// The United States spans 11 USDA Hardiness Zones (1a through 13b),
// encompassing every major climate type from arctic tundra to tropical savanna.
// Each climate zone creates a fundamentally different set of constraints for
// enclosed-structure agriculture.
//
// These 10 profiles are the result of deep research into:
//   - NOAA climate normals (1991-2020 baselines)
//   - USDA Hardiness Zone mapping (2023 revision)
//   - State Extension Service greenhouse management guides
//   - NGMA structural engineering standards for wind/snow loads
//   - Regional disease and pest pressure surveys (APS, ESA)
//
// Each profile encodes:
//   name             — Human-readable climate zone name
//   usdaZones        — Typical USDA Hardiness Zone range
//   primaryThreat    — The #1 environmental challenge for enclosed crops
//   structuralAdvice — Engineering recommendation for greenhouse construction
//   avgPeakSolar     — Peak solar irradiance (W/m²) at solar noon (clear sky, summer)
//   frostFreeWindow  — Approximate outdoor frost-free season (days)
//   dominantHumidity — Characteristic RH behavior ('wet', 'dry', 'seasonal', 'marine')
//   heatingPriority  — Relative heating energy cost ('extreme', 'high', 'moderate', 'low', 'minimal')
//   ventPriority     — Relative ventilation/cooling importance ('extreme', 'high', 'moderate', 'low')
//
// USAGE:
//   The user selects a climateProfile in globalSettings. The physics engine
//   uses it to:
//     1. Set default frost probability windows
//     2. Calibrate solar gain multipliers by latitude
//     3. Select pest GDD baselines (tropical vs. temperate species)
//     4. Generate structural engineering warnings
//
// ═══════════════════════════════════════════════════════════════════════════════

export const CLIMATE_PROFILES = {

    // ─────────────────────────────────────────────────────────────────────────
    // 1. ARCTIC CRYOSPHERE — Alaska Interior / North Slope / Extreme North
    // ─────────────────────────────────────────────────────────────────────────
    //
    // The most extreme enclosed-growing environment in the U.S.
    // Summer daylight can exceed 20 hours, but winter is near-total darkness.
    // Permafrost underlies most structures — foundations must be on piles.
    // Wind chill can reach -60°F; heating is the dominant energy cost.
    //
    // Growing season: June–August (60–90 days).
    // Key crops: cold-hardy greens, root vegetables, herbs.
    //
    // Source: UAF Cooperative Extension (Fairbanks), NOAA Alaska Region
    //
    arctic_cryosphere: {
        name: 'Arctic / Cryosphere',
        usdaZones: '1–3',
        primaryThreat:
            'EXTREME COLD & LIGHT DEPRIVATION. Winter temps routinely -40°F. ' +
            'Solar radiation drops to near-zero for 2-4 months. Permafrost ' +
            'prevents conventional foundation work. Wind chill amplifies ' +
            'heat loss through glazing by 3-5× during Arctic storms.',
        structuralAdvice:
            'Triple-wall polycarbonate or insulated rigid panels required. ' +
            'Pile foundations over permafrost — never pour concrete on frozen ground. ' +
            'Supplemental LED lighting (400+ µmol/m²/s PPFD) mandatory Nov–Feb. ' +
            'Vestibule airlocks on all entry points to prevent thermal shock. ' +
            'Snow load rating: ≥60 psf (NGMA). Wind load: ≥120 mph equiv.',
        avgPeakSolar: 650,
        frostFreeWindow: 75,
        dominantHumidity: 'dry',
        heatingPriority: 'extreme',
        ventPriority: 'low'
    },

    // ─────────────────────────────────────────────────────────────────────────
    // 2. BOREAL CONTINENTAL — Upper Midwest / Dakotas / Minnesota / Montana
    // ─────────────────────────────────────────────────────────────────────────
    //
    // Extreme temperature swings: -30°F winters to 95°F summers.
    // The 40–60°F diurnal temperature range in spring/fall creates massive
    // condensation challenges inside structures. Humidity is generally low
    // (30-40% RH in winter), but spring snowmelt saturates soils.
    //
    // Wind is relentless across the northern Plains — structures must be
    // oriented perpendicular to prevailing NW winds for snow shedding.
    //
    // Growing season: May–September (120–150 days).
    // Key crops: brassicas, root vegetables, small fruits.
    //
    // Source: NDSU Extension, UMN Dept of Horticultural Science
    //
    boreal_continental: {
        name: 'Boreal Continental',
        usdaZones: '3–4',
        primaryThreat:
            'EXTREME DIURNAL SWINGS & WIND. Temperature can vary 50°F in 24 hours ' +
            'during transitional seasons. This causes catastrophic condensation ' +
            'cycling (freeze → thaw → free water → refreeze) that destroys both ' +
            'crops and structures. Sustained 40+ mph winter winds are common on the Plains.',
        structuralAdvice:
            'Double-poly inflated glazing minimum. Gothic arch profile for snow shedding. ' +
            'Orient ridge perpendicular to prevailing NW wind (typically EW ridge). ' +
            'Snow load rating: ≥40 psf. Wind bracing on every other bow. ' +
            'Automated night curtains or thermal blankets for overnight insulation. ' +
            'Consider ground-to-air heat transfer (GAHT) for passive thermal mass.',
        avgPeakSolar: 850,
        frostFreeWindow: 135,
        dominantHumidity: 'dry',
        heatingPriority: 'high',
        ventPriority: 'moderate'
    },

    // ─────────────────────────────────────────────────────────────────────────
    // 3. COLD HUMID INTERIOR — New England / Great Lakes / Upper Appalachia
    // ─────────────────────────────────────────────────────────────────────────
    //
    // The baseline profile for this application (Nobleboro, Maine).
    // Maritime-continental transition with moderate-to-heavy snowfall,
    // persistent cloud cover in winter, and high humidity year-round.
    //
    // Botrytis cinerea is the #1 enclosed-structure pathogen. The combination
    // of cold nights (condensation) and warm days (sporulation) creates a
    // perfect disease cycle from October through May.
    //
    // Growing season: May–October (150–175 days).
    // Key crops: tomatoes, greens, herbs, brassicas.
    //
    // Source: UMaine Extension, Cornell CEA Program, UNH Greenhouse Ops
    //
    cold_humid_interior: {
        name: 'Cold Humid Interior',
        usdaZones: '4–6',
        primaryThreat:
            'BOTRYTIS CINEREA & HUMIDITY MANAGEMENT. Persistent humidity (60-90% RH) ' +
            'combined with cold nights creates chronic condensation. Gray mold ' +
            'sporulates on pruning wounds, fruit scars, and senescing petals. ' +
            'A single overnight condensation event in an unvented tomato house ' +
            'can initiate an infection cycle that costs 30%+ of the crop.',
        structuralAdvice:
            'Double-poly inflated is the regional standard. Automated ridge vents ' +
            'strongly recommended for passive dehumidification. HAF (Horizontal Air Flow) ' +
            'fans mandatory — 2 cfm per sqft minimum. Night crack-venting protocol essential ' +
            'Oct–May to break dew point. Snow load: ≥30 psf. ' +
            'Consider propane unit heaters for combined heating + dehumidification.',
        avgPeakSolar: 900,
        frostFreeWindow: 165,
        dominantHumidity: 'wet',
        heatingPriority: 'high',
        ventPriority: 'high'
    },

    // ─────────────────────────────────────────────────────────────────────────
    // 4. HIGH ALTITUDE ARID — Rocky Mountain / Intermountain West
    // ─────────────────────────────────────────────────────────────────────────
    //
    // Extreme UV radiation at altitude (5,000–8,000 ft). Solar irradiance
    // can exceed 1100 W/m² — among the highest in the continental U.S.
    // This creates simultaneous challenges: intense daytime overheating
    // and severe nighttime radiative cooling (30-40°F drops common).
    //
    // Low humidity (15-30% RH baseline) means VPD is chronically high.
    // Spider mites thrive; Botrytis is rare. Evaporative cooling is
    // extremely effective due to the large wet-bulb depression.
    //
    // Growing season: Highly variable by elevation (90–160 days).
    // Key crops: tomatoes, peppers, cannabis, herbs.
    //
    // Source: CSU Extension, USU Greenhouse Management, NM Ag Extension
    //
    high_altitude_arid: {
        name: 'High Altitude Arid',
        usdaZones: '4–6',
        primaryThreat:
            'UV OVEREXPOSURE & EXTREME DIURNAL SWING. Solar UV at 6,000 ft is ' +
            '25-30% stronger than sea level. Unshaded glazing transmits enough UV-B ' +
            'to cause leaf bleaching and fruit sunscald within hours. Nighttime ' +
            'radiative cooling to clear skies drops interior temps 30-40°F from daytime peaks. ' +
            'Chronic low humidity (15-30% RH) drives VPD above 2.0 kPa — spider mite territory.',
        structuralAdvice:
            'UV-stabilized glazing with 30-50% shade cloth (seasonal). ' +
            'Evaporative cooling pads highly effective (wet-bulb depression often 25-35°F). ' +
            'Thermal mass critical: water barrels (2.5 gal/sqft), GAHT, or rock beds. ' +
            'Consider single-poly over double to maximize beneficial light in shoulder seasons. ' +
            'Wind load: ≥90 mph (mountain gusts). Snow varies wildly by microsite.',
        avgPeakSolar: 1100,
        frostFreeWindow: 130,
        dominantHumidity: 'dry',
        heatingPriority: 'high',
        ventPriority: 'high'
    },

    // ─────────────────────────────────────────────────────────────────────────
    // 5. CLOUDY MARINE — Pacific Northwest / Coastal WA-OR / Puget Sound
    // ─────────────────────────────────────────────────────────────────────────
    //
    // Among the lowest solar radiation environments in the lower 48.
    // Overcast 200+ days per year. Mild temperatures (rarely below 25°F
    // or above 85°F) but perpetual cloud cover limits photosynthesis.
    //
    // Humidity is chronically 70-95%. Downy mildew and Pythium root rot
    // are the dominant pathogens — Botrytis is present but less severe
    // than New England due to milder temperatures.
    //
    // Growing season: Nearly year-round for cool crops (240+ days).
    // Key crops: greens, herbs, berries, starts/transplants.
    //
    // Source: WSU Extension, OSU greenhouse program, Tilth Alliance
    //
    cloudy_marine: {
        name: 'Cloudy Marine (Pacific NW)',
        usdaZones: '7–9',
        primaryThreat:
            'CHRONIC LOW LIGHT & PERSISTENT DAMPNESS. Only 200-300 W/m² average winter ' +
            'irradiance. Overcast > 200 days/yr reduces photosynthetic output by 40-60% ' +
            'vs. continental locations at the same latitude. Constant drizzle and marine ' +
            'fog sustain 80-95% RH — ideal conditions for Downy Mildew, Pythium root rot, ' +
            'and Fusarium wilt. Air circulation is paramount.',
        structuralAdvice:
            'Maximize light transmission: single-poly or glass glazing. Avoid double-poly ' +
            'unless heating cost justifies the 10-15% light loss. Anti-condensation (AC) ' +
            'drip-reducing glazing film strongly recommended. Supplemental LED lighting ' +
            '(200+ µmol PPFD) for winter production of fruiting crops. ' +
            'HAF fans at 3 cfm/sqft to combat stagnant damp air. Snow load: ≤15 psf. ' +
            'Wind load: ≥90 mph (coastal storms).',
        avgPeakSolar: 700,
        frostFreeWindow: 250,
        dominantHumidity: 'marine',
        heatingPriority: 'moderate',
        ventPriority: 'high'
    },

    // ─────────────────────────────────────────────────────────────────────────
    // 6. HUMID TEMPERATE — Mid-Atlantic / Ohio Valley / Chesapeake
    // ─────────────────────────────────────────────────────────────────────────
    //
    // The "Goldilocks" zone for U.S. greenhouse production — enough sun for
    // fruiting crops, cold enough to break pest cycles, warm enough that
    // heating costs are manageable. This is where most commercial greenhouse
    // operations in the eastern U.S. concentrate.
    //
    // Summer humidity (70-90% RH) with high temperatures creates VPD
    // management challenges opposite to the high-altitude zones: VPD crashes
    // too LOW, not too high. Bacterial diseases (Pseudomonas, Xanthomonas)
    // are more common than in colder zones.
    //
    // Growing season: April–November (180–210 days).
    // Key crops: tomatoes, peppers, cucumbers, cut flowers.
    //
    // Source: UMD Extension, PSU greenhouse program, VA Tech CEA
    //
    humid_temperate: {
        name: 'Humid Temperate',
        usdaZones: '6–7',
        primaryThreat:
            'SUMMER VPD COLLAPSE & BACTERIAL DISEASES. July-August RH routinely 80-95% ' +
            'with temps 85-100°F. VPD drops below 0.4 kPa even at midday. Free water ' +
            'persists on leaf surfaces for 6-10 hours daily. Bacterial leaf spot, ' +
            'angular leaf spot, and soft rot (Erwinia) thrive. Ventilation alone cannot ' +
            'overcome ambient humidity — mechanical dehumidification may be needed.',
        structuralAdvice:
            'Retractable roof or open-roof design ideal for summer venting. ' +
            'Roll-up sidewalls (minimum 4 ft) on both sides mandatory. Ridge vents ' +
            'with insect screening (52-mesh for thrips exclusion). Consider evaporative ' +
            'wall + exhaust fan for forced ventilation. Double-poly for winter heating ' +
            'savings. Snow load: ≥20 psf. Insect pressure warrants full screening.',
        avgPeakSolar: 950,
        frostFreeWindow: 195,
        dominantHumidity: 'wet',
        heatingPriority: 'moderate',
        ventPriority: 'extreme'
    },

    // ─────────────────────────────────────────────────────────────────────────
    // 7. MIXED HUMID SOUTH — Upper South / Piedmont / TN-NC-GA-VA Uplands
    // ─────────────────────────────────────────────────────────────────────────
    //
    // Transitional zone between temperate and subtropical. Long, hot, humid
    // summers but with real winters (10-20 hard frost events per year).
    // The extended shoulder seasons (March and November are productive) are
    // the primary advantage over northern zones.
    //
    // Insect pressure is significantly higher than Zone 5-6: whitefly,
    // aphids, and thrips overwinter outdoors and re-infest structures
    // year-round. Two-spotted spider mite is the summer pest of record.
    //
    // Growing season: March–November (220–260 days).
    // Key crops: tomatoes, peppers, cucumbers, specialty herbs, cut flowers.
    //
    // Source: NCSU CEA Program, UT Extension, UGA greenhouse management
    //
    mixed_humid_south: {
        name: 'Mixed Humid South',
        usdaZones: '7–8',
        primaryThreat:
            'YEAR-ROUND INSECT PRESSURE & HEAT STRESS. Unlike northern zones where ' +
            'winter kills pest populations, the Upper South has continuous pest cycles. ' +
            'Whitefly, thrips, and aphids overwinter in adjacent fields and re-infest ' +
            'greenhouses through any gap > 0.2 mm. Summer temps above 95°F persist ' +
            'for 60+ days — pollen desiccation causes near-total reproductive failure ' +
            'in solanaceous crops without active cooling.',
        structuralAdvice:
            'Full insect exclusion screening (52-mesh minimum) on ALL openings. ' +
            'Pad-and-fan cooling system rated for 1 air change per minute. Shade cloth ' +
            '(40-50% aluminet) April–September. Double entry vestibule with sticky traps. ' +
            'Single-poly adequate for mild winters — double only if heating costs justify. ' +
            'Snow load: ≤15 psf. Wind load: ≥100 mph (hurricane remnants possible).',
        avgPeakSolar: 1000,
        frostFreeWindow: 240,
        dominantHumidity: 'wet',
        heatingPriority: 'moderate',
        ventPriority: 'extreme'
    },

    // ─────────────────────────────────────────────────────────────────────────
    // 8. COASTAL MEDITERRANEAN — California Central Coast / SoCal / Napa
    // ─────────────────────────────────────────────────────────────────────────
    //
    // Near-ideal growing conditions: 300+ sunny days, mild winters (frost
    // rare below 2,000 ft), moderate humidity. This is the climate that
    // greenhouse design was OPTIMIZED for — open-roof and retractable
    // structures dominate the California commercial market.
    //
    // The threat profile is inverted from humid zones: intense UV, wind,
    // and wildfire smoke are the primary challenges. Pathogen pressure is
    // low but Powdery Mildew thrives in the 40-70% RH sweet spot with
    // warm dry days and cool dewy nights.
    //
    // Growing season: Year-round (340+ days).
    // Key crops: berries, cannabis, cut flowers, specialty vegetables.
    //
    // Source: UCCE (UC Cooperative Extension), CalPoly CEA,
    //         CA Dept of Food and Agriculture
    //
    coastal_med: {
        name: 'Coastal Mediterranean',
        usdaZones: '9–11',
        primaryThreat:
            'POWDERY MILDEW, UV INTENSITY & WILDFIRE SMOKE. The Mediterranean day/night ' +
            'cycle (warm dry days → cool dewy nights) is the exact infection cycle for ' +
            'powdery mildew (Podosphaera, Erysiphe). Unlike Botrytis, powdery mildew ' +
            'thrives at MODERATE humidity (40-70% RH) with dry leaf surfaces. ' +
            'Wildfire smoke events (Aug–Nov) dramatically reduce PAR and deposit ' +
            'particulates on glazing, requiring immediate washdown.',
        structuralAdvice:
            'Retractable-roof or open-roof structures are the regional standard. ' +
            'Permanent sidewall screening for pest exclusion. UV-blocking glazing for ' +
            'specialty crops (lettuce, herbs). Sulfur burners for powdery mildew management. ' +
            'Minimal heating infrastructure needed — emergency propane only. ' +
            'Fire-resistant site planning: defensible space, metal conduit, no adjacent brush. ' +
            'Seismic bracing per CBC/ASCE 7. Wind load: ≥85 mph (Santa Ana events).',
        avgPeakSolar: 1050,
        frostFreeWindow: 340,
        dominantHumidity: 'seasonal',
        heatingPriority: 'low',
        ventPriority: 'moderate'
    },

    // ─────────────────────────────────────────────────────────────────────────
    // 9. HOT ARID DESERT — Desert Southwest / AZ / NV / West TX / NM
    // ─────────────────────────────────────────────────────────────────────────
    //
    // The most extreme heat environment in the U.S. Ambient temps exceed
    // 115°F for weeks. Solar irradiance peaks at 1200+ W/m². Humidity can
    // drop below 5% RH — VPD exceeds 5.0 kPa, which is lethal for most crops.
    //
    // Evaporative cooling is SPECTACULARLY effective here: wet-bulb depression
    // can exceed 35°F, meaning a 110°F ambient can be cooled to 75°F through
    // evaporative pads alone.
    //
    // Water is the limiting resource, not light or heat. Every gallon counts.
    //
    // Growing season: Year-round with cooling infrastructure.
    // Key crops: tomatoes, peppers, cucumbers (cooled), herbs, dates.
    //
    // Source: UA-CEA (University of Arizona), NMSU desert greenhouse program,
    //         USDA-ARS Arid Land Ag Research Center
    //
    hot_arid_desert: {
        name: 'Hot Arid Desert',
        usdaZones: '9–13',
        primaryThreat:
            'LETHAL HEAT & WATER SCARCITY. Unmodified interior temps exceed 150°F at ' +
            'solar noon. VPD above 5.0 kPa causes instantaneous stomatal closure — ' +
            'photosynthesis stops, transpiration stops, and leaf temps spike to lethal ' +
            'levels (>130°F surface temp). Without evaporative cooling, no temperate crop ' +
            'survives. Water-use efficiency must be maximized: every gallon of cooling ' +
            'water that evaporates is a gallon that can\'t irrigate.',
        structuralAdvice:
            'Pad-and-fan evaporative cooling is mandatory (wet-bulb depression 30-40°F). ' +
            'Whitewash or 60-70% reflective shade cloth year-round. Open roof designs ' +
            'CONTRAINDICATED — they let in too much direct heat. Fan-driven exhaust with ' +
            'cellulose pad intake is the proven system. Drip irrigation with moisture sensors. ' +
            'Recirculating nutrient film technique (NFT) or deep water culture (DWC) reduces ' +
            'water waste by 80-90% vs. soil. No snow load. Wind load: ≥90 mph (dust storms).',
        avgPeakSolar: 1200,
        frostFreeWindow: 300,
        dominantHumidity: 'dry',
        heatingPriority: 'low',
        ventPriority: 'extreme'
    },

    // ─────────────────────────────────────────────────────────────────────────
    // 10. SUBTROPICAL — Gulf Coast / Florida / Deep South / Hawaii (lowland)
    // ─────────────────────────────────────────────────────────────────────────
    //
    // Year-round warmth (frost rare, never sustained) with extreme humidity
    // (75-100% RH baseline). The growing constraints are almost entirely
    // biological, not thermal: insect and disease pressure never stops.
    //
    // Hurricanes are the structural threat that dominates engineering.
    // All greenhouse structures in this zone must be rated for 150+ mph
    // sustained winds. Polycarbonate or screen houses replace poly film.
    //
    // Summer rain (50-70 inches/yr) creates waterlogged conditions that
    // favor Phytophthora, Pythium, and bacterial wilt (Ralstonia).
    //
    // Growing season: Year-round.
    // Key crops: tropical fruits, ornamentals, transplants, herbs, cannabis.
    //
    // Source: UF/IFAS (University of Florida), LSU AgCenter,
    //         CTAHR (Hawaii, lowland sites)
    //
    subtropical: {
        name: 'Subtropical',
        usdaZones: '8–11',
        primaryThreat:
            'RELENTLESS INSECT & DISEASE PRESSURE + HURRICANE RISK. Pest populations ' +
            'never crash — there is no winter kill. Whitefly, thrips, aphids, ' +
            'leafminers, and broad mites reproduce continuously. Fungal diseases ' +
            '(Phytophthora, Pythium, Rhizoctonia) thrive in waterlogged, warm soils. ' +
            'Bacterial wilt (Ralstonia solanacearum) is soil-persistent and uncurable. ' +
            'Hurricane-force winds ≥150 mph are a design-basis structural event.',
        structuralAdvice:
            'Screen houses (30% shade + pest exclusion) preferred over sealed structures. ' +
            'If sealed: forced-air cooling with HEPA-filtered intake for bioexclusion. ' +
            'Hurricane-rated gothic arch frames with ground anchors (not post-in-ground). ' +
            'Polycarbonate glazing — poly film WILL be destroyed in first storm. ' +
            'Elevated benches or containerized production (no ground contact) to prevent ' +
            'soilborne disease. Standing water drainage: 2% minimum floor slope. ' +
            'No snow load. Wind load: ≥150 mph (ASCE 7 Risk Category III for ag structures).',
        avgPeakSolar: 1000,
        frostFreeWindow: 350,
        dominantHumidity: 'wet',
        heatingPriority: 'minimal',
        ventPriority: 'extreme'
    }
};

/**
 * List all valid climate profile keys.
 * Useful for UI dropdowns, settings screens, and input validation.
 */
export const CLIMATE_PROFILE_KEYS = Object.keys(CLIMATE_PROFILES);


// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 15: PHOTOSYNTHETIC CROP TYPES — C3 / CAM CLASSIFICATION
// ═══════════════════════════════════════════════════════════════════════════════
//
// Plants use three main photosynthetic pathways: C3, C4, and CAM.
// In enclosed greenhouse production, only C3 and CAM are commercially
// relevant. (C4 crops — corn, sugarcane, sorghum — are almost never
// grown in greenhouses due to their massive space requirements.)
//
// The photosynthetic pathway determines:
//
//   1. CO₂ RESPONSE — C3 plants respond linearly to CO₂ enrichment up to
//      ~1000 ppm, increasing yield 20-40%. CAM plants do NOT respond to
//      enrichment because they fix CO₂ at night through a different enzyme.
//
//   2. LIGHT SATURATION — C3 fruiting crops saturate at 600-800 µmol/m²/s
//      PPFD. C3 leafy crops saturate at 200-400 µmol/m²/s. CAM succulents
//      have very low light requirements (100-300 µmol/m²/s).
//
//   3. WATER USE EFFICIENCY — CAM plants are 3-6× more water-efficient
//      than C3 because they open stomata at NIGHT (when VPD is lowest)
//      and fix CO₂ into organic acids. During the day, stomata are CLOSED,
//      preventing transpiration while the plant decarboxylates the stored
//      acids and runs the Calvin cycle internally.
//
//   4. TEMPERATURE RESPONSE — C3 fruiting crops are thermophilic (65-85°F
//      optimum). C3 leafy crops prefer cool conditions (45-70°F). CAM
//      succulents are heat-tolerant but cold-sensitive (minimum 45-50°F).
//
// This classification drives crop-specific physics engine behavior:
//   - CO₂ enrichment ROI calculations
//   - Supplemental lighting band selection (red:blue ratio)
//   - Irrigation scheduling (CAM needs 50-70% less water)
//   - VPD target adjustments (CAM: lower VPD tolerance at night)
//
// Source:
//   - Taiz & Zeiger (2015) Plant Physiology, 6th ed. Ch. 8-10
//   - Nobel (2009) Physicochemical & Environmental Plant Physiology, 4th ed.
//   - Kubota & Fernandez (2020) CEA Crop Physiology, USDA-SCRI
//
// ═══════════════════════════════════════════════════════════════════════════════

export const PHOTOSYNTHETIC_CROP_TYPES = {

    // ──────────────────────────────────────────────────────────────────────
    // C3 FRUITING — Tomatoes, Peppers, Cucumbers, Eggplant, Strawberries
    // ──────────────────────────────────────────────────────────────────────
    //
    // C3 pathway: CO₂ fixation by RuBisCO directly into 3-phosphoglycerate.
    // Photorespiration is a significant energy loss at high temperatures
    // (>85°F RuBisCO increasingly fixes O₂ instead of CO₂).
    //
    // These are the HIGH-VALUE crops that justify heating, supplemental
    // lighting, and CO₂ enrichment in commercial operations.
    //
    c3_fruiting: {
        label: 'C3 Fruiting Crops',
        icon: '🍅',
        pathway: 'C3',
        description:
            'Tomatoes, peppers, cucumbers, eggplant, strawberries. ' +
            'High-value thermophilic crops with strong CO₂ response.',
        optimalDayTempF: { min: 70, max: 85 },
        optimalNightTempF: { min: 60, max: 68 },
        lightSaturationPPFD: 800,       // µmol/m²/s — beyond this, no yield gain
        lightCompensationPPFD: 50,      // Below this, respiration > photosynthesis
        co2ResponseCurve: 'linear',     // Yield increases linearly up to ~1000 ppm
        co2EnrichmentCeiling: 1000,     // ppm — diminishing returns above this
        co2EnrichmentYieldBoost: 0.30,  // +30% yield at 1000 ppm vs. 400 ppm ambient
        waterUseEfficiency: 'low',      // High transpiration rate (1-3 L/plant/day)
        vpdOptimal: { min: 0.8, max: 1.6 },  // kPa — phase-dependent (see getVPDStatus)
        photorespirationRisk:
            'High above 85°F. RuBisCO affinity for O₂ increases with temperature, ' +
            'wasting 25-40% of fixed carbon. This is why tomato yield DROPS above 85°F ' +
            'even with ample light and CO₂.',
        exampleCrops: ['solanaceous', 'cucurbits']
    },

    // ──────────────────────────────────────────────────────────────────────
    // C3 LEAFY — Lettuce, Spinach, Kale, Herbs, Microgreens
    // ──────────────────────────────────────────────────────────────────────
    //
    // Same C3 pathway but adapted for low-light, cool conditions.
    // These crops BOLT (flower prematurely) under high light and heat,
    // rendering them unmarketable. The physics engine must prevent this.
    //
    // Lower light saturation means supplemental lighting is cheaper and
    // more productive per watt. This makes leafy C3 crops the best
    // candidates for winter production in northern zones.
    //
    c3_leafy: {
        label: 'C3 Leafy Crops',
        icon: '🥬',
        pathway: 'C3',
        description:
            'Lettuce, spinach, kale, herbs, microgreens, edible flowers. ' +
            'Cool-season crops with low light needs and bolt sensitivity.',
        optimalDayTempF: { min: 45, max: 70 },
        optimalNightTempF: { min: 35, max: 55 },
        lightSaturationPPFD: 400,       // Much lower than fruiting crops
        lightCompensationPPFD: 20,      // Can photosynthesize in very dim conditions
        co2ResponseCurve: 'linear',     // Responds well to enrichment
        co2EnrichmentCeiling: 800,      // ppm — lower ceiling than fruiting crops
        co2EnrichmentYieldBoost: 0.25,  // +25% yield (primarily leaf mass)
        waterUseEfficiency: 'moderate', // Lower transpiration than fruiting crops
        vpdOptimal: { min: 0.4, max: 1.0 },  // kPa — requires gentle atmospheric demand
        photorespirationRisk:
            'Moderate. Leafy crops are less impacted because they operate at lower ' +
            'temperatures where RuBisCO affinity for CO₂ is strongly favored. ' +
            'However, heat-induced bolting is the real threat — once the flowering ' +
            'hormone cascade initiates, the crop is lost.',
        exampleCrops: ['coldHardyGreens', 'rootVeggies']
    },

    // ──────────────────────────────────────────────────────────────────────
    // CAM SUCCULENT — Cacti, Agave, Aloe, Sedum, Ornamental Succulents
    // ──────────────────────────────────────────────────────────────────────
    //
    // CAM (Crassulacean Acid Metabolism) is a fundamentally different
    // approach to photosynthesis. These plants REVERSE the day/night
    // gas exchange pattern:
    //
    //   NIGHT: Stomata OPEN. CO₂ enters. Fixed into malic acid (C4 acid)
    //          by PEP carboxylase. Stored in vacuoles. Transpiration occurs
    //          at the LOWEST VPD of the day → extreme water efficiency.
    //
    //   DAY:   Stomata CLOSED. Malic acid decarboxylated back to CO₂.
    //          CO₂ re-fixed by RuBisCO in Calvin cycle. No transpiration
    //          → no water loss. No gas exchange with atmosphere.
    //
    // This pathway is SLOW (low growth rate) but extraordinarily efficient
    // with water. CAM plants need 3-6× LESS water than C3 crops.
    //
    // CRITICAL: CO₂ enrichment during the DAY is USELESS for CAM plants
    // because their stomata are closed. If enriching, do it at NIGHT
    // (which is exactly when most growers vent and purge CO₂).
    //
    cam_succulent: {
        label: 'CAM Succulents',
        icon: '🌵',
        pathway: 'CAM',
        description:
            'Cacti, agave, aloe, sedum, echeveria, jade, ornamental succulents. ' +
            'Night-fixing crops with extreme water efficiency and low light needs.',
        optimalDayTempF: { min: 70, max: 95 },
        optimalNightTempF: { min: 50, max: 65 },
        lightSaturationPPFD: 300,       // Very low — adapted to semi-arid conditions
        lightCompensationPPFD: 10,      // Can survive in remarkably low light
        co2ResponseCurve: 'nocturnal',  // Only responds to CO₂ when stomata are open (night)
        co2EnrichmentCeiling: 600,      // ppm — night-only enrichment
        co2EnrichmentYieldBoost: 0.10,  // +10% at best (slow growers)
        waterUseEfficiency: 'extreme',  // 3-6× better than C3
        vpdOptimal: { min: 0.3, max: 1.2 },  // kPa — low night VPD is critical
        photorespirationRisk:
            'Minimal. Because CAM plants run the Calvin cycle behind closed stomata ' +
            'with internally-generated CO₂ at high concentrations, photorespiration is ' +
            'suppressed. This is one reason succulents tolerate extreme heat — they\'re ' +
            'not losing 30% of fixed carbon to RuBisCO\'s oxygenase activity.',
        exampleCrops: []
    }
};

/**
 * List all valid crop type keys.
 * Useful for UI dropdowns and input validation.
 */
export const CROP_TYPE_KEYS = Object.keys(PHOTOSYNTHETIC_CROP_TYPES);


// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 16: NWS WEATHER API — DIRECT FEDERAL FORECAST INTEGRATION
// ═══════════════════════════════════════════════════════════════════════════════
//
// The National Weather Service (NWS) API (api.weather.gov) is:
//   - FREE — no API key required
//   - AUTHORITATIVE — this IS the official U.S. forecast
//   - HOURLY — provides 156-hour (6.5 day) forecasts at 1-hour resolution
//   - RATE-LIMITED — be a good citizen; cache aggressively
//
// The NWS API uses a two-step fetch pattern:
//
//   STEP 1: /points/{lat},{lon}
//     Returns metadata about the forecast grid, including the URL for
//     the hourly forecast endpoint. This URL is STABLE per location —
//     cache it and reuse it. It changes only if the grid changes.
//
//   STEP 2: /gridpoints/{office}/{gridX},{gridY}/forecast/hourly
//     Returns the actual hourly forecast with temperature, humidity,
//     wind speed, wind direction, sky cover (cloud %), precipitation
//     probability, and textual short forecasts.
//
// NWS requires a User-Agent header identifying your application.
// Requests without a User-Agent may be throttled or blocked.
//
// Rate limit policy: No hard numeric limit, but NWS asks for
// "reasonable" usage. For our use case, 1 fetch per 5 minutes is
// well within bounds (forecast data only updates every 1-2 hours anyway).
//
// Source: https://www.weather.gov/documentation/services-web-api
//
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * User-Agent string for NWS API requests.
 * NWS requires this to identify the application making requests.
 * Format: "AppName/Version (contact-email)"
 */
const NWS_USER_AGENT = 'PracticalFarmTools/1.0 (support@practicalfarmtools.com)';

/**
 * Cache for the NWS grid metadata (/points endpoint).
 * Keyed by "lat,lon" string. Each entry stores:
 *   { forecastHourlyUrl: string, office: string, gridX: number, gridY: number, fetchedAt: number }
 *
 * This cache prevents redundant /points lookups — the grid metadata
 * for a given coordinate is STABLE and rarely changes.
 * @type {Map<string, object>}
 */
const nwsGridCache = new Map();

/**
 * Fetches the hourly weather forecast from the NWS API for a given lat/lon.
 *
 * This is a two-step process:
 *   1. Resolve the lat/lon to a forecast grid via /points/{lat},{lon}
 *   2. Fetch the hourly forecast from the resolved grid URL
 *
 * Returns a structured object with the next 12–24 hours of hourly data,
 * parsed into a format compatible with the Greenhouse OS physics engine.
 *
 * @param {number} lat — Latitude in decimal degrees (e.g., 44.0784)
 * @param {number} lon — Longitude in decimal degrees (e.g., -69.4892)
 *
 * @returns {Promise<object>} Structured forecast:
 *   {
 *     success: boolean,
 *     source: 'NWS',
 *     location: { lat, lon, office, gridX, gridY },
 *     fetchedAt: string (ISO 8601),
 *     current: {                     — First forecast period (closest to "now")
 *       tempF: number,
 *       rh: number,
 *       windMph: number,
 *       windDir: number,
 *       skyCover: number,
 *       shortForecast: string
 *     },
 *     hourly: Array<{               — Next 12-24 hours of hourly data
 *       startTime: string,
 *       tempF: number,
 *       rh: number,
 *       windMph: number,
 *       windDir: string,
 *       windDirDeg: number,
 *       skyCover: number,
 *       precipProb: number,
 *       shortForecast: string,
 *       isDaytime: boolean
 *     }>,
 *     skyCoverArray: number[],       — Just the sky cover %s (for DLI calc)
 *     error: string|null
 *   }
 *
 * @example
 *   const wx = await fetchNWSWeather(44.0784, -69.4892);
 *   if (wx.success) {
 *     devLog(`Current: ${wx.current.tempF}°F, ${wx.current.rh}% RH`);
 *     const dli = calculateEstimatedDLI(44.0784, dayOfYear, wx.skyCoverArray);
 *   }
 */
export async function fetchNWSWeather(lat, lon) {

    // ── Input validation ──
    if (typeof lat !== 'number' || typeof lon !== 'number' ||
        lat < -90 || lat > 90 || lon < -180 || lon > 180) {
        return {
            success: false, source: 'NWS',
            location: { lat, lon },
            fetchedAt: new Date().toISOString(),
            current: null, hourly: [], skyCoverArray: [],
            error: `Invalid coordinates: lat=${lat}, lon=${lon}. ` +
                   `Must be lat [-90,90] and lon [-180,180].`
        };
    }

    // Round to 4 decimal places (NWS API precision limit)
    const roundedLat = parseFloat(lat.toFixed(4));
    const roundedLon = parseFloat(lon.toFixed(4));
    const cacheKey = `${roundedLat},${roundedLon}`;

    try {
        // ═══════════════════════════════════════════════════════════════
        //  STEP 1: Resolve grid metadata (cached)
        // ═══════════════════════════════════════════════════════════════
        //
        //  The /points endpoint returns the forecast office, grid
        //  coordinates, and the URL for the hourly forecast. This data
        //  is STABLE — cache it for the session lifetime.

        let gridMeta = nwsGridCache.get(cacheKey);

        if (!gridMeta) {
            const pointsUrl = `https://api.weather.gov/points/${roundedLat},${roundedLon}`;

            const pointsRes = await fetch(pointsUrl, {
                headers: {
                    'User-Agent': NWS_USER_AGENT,
                    'Accept': 'application/geo+json'
                }
            });

            if (!pointsRes.ok) {
                // NWS returns 404 for coordinates outside the U.S.
                if (pointsRes.status === 404) {
                    return {
                        success: false, source: 'NWS',
                        location: { lat: roundedLat, lon: roundedLon },
                        fetchedAt: new Date().toISOString(),
                        current: null, hourly: [], skyCoverArray: [],
                        error: `NWS does not cover coordinates (${roundedLat}, ${roundedLon}). ` +
                               `The NWS API only serves U.S. locations.`
                    };
                }
                throw new Error(`NWS /points returned HTTP ${pointsRes.status}`);
            }

            const pointsData = await pointsRes.json();
            const props = pointsData.properties;

            if (!props || !props.forecastHourly) {
                throw new Error('NWS /points response missing forecastHourly URL.');
            }

            gridMeta = {
                forecastHourlyUrl: props.forecastHourly,
                office: props.gridId || props.cwa || '',
                gridX: props.gridX,
                gridY: props.gridY,
                fetchedAt: Date.now()
            };

            nwsGridCache.set(cacheKey, gridMeta);
        }

        // ═══════════════════════════════════════════════════════════════
        //  STEP 2: Fetch hourly forecast
        // ═══════════════════════════════════════════════════════════════
        //
        //  The hourly forecast returns 156 periods (6.5 days).
        //  We parse the first 24 for the immediate operational window.

        const hourlyRes = await fetch(gridMeta.forecastHourlyUrl, {
            headers: {
                'User-Agent': NWS_USER_AGENT,
                'Accept': 'application/geo+json'
            }
        });

        if (!hourlyRes.ok) {
            throw new Error(`NWS hourly forecast returned HTTP ${hourlyRes.status}`);
        }

        const hourlyData = await hourlyRes.json();
        const periods = hourlyData.properties?.periods;

        if (!Array.isArray(periods) || periods.length === 0) {
            throw new Error('NWS hourly response contained no forecast periods.');
        }

        // ═══════════════════════════════════════════════════════════════
        //  STEP 3: Parse forecast periods into engine-compatible format
        // ═══════════════════════════════════════════════════════════════
        //
        //  NWS period fields:
        //    temperature:       number (in temperatureUnit)
        //    temperatureUnit:   'F' or 'C'
        //    relativeHumidity:  { value: number, unitCode: 'wmoUnit:percent' }
        //    windSpeed:         string like "10 mph" or "5 to 10 mph"
        //    windDirection:     string like "NW", "SSE", etc.
        //    probabilityOfPrecipitation: { value: number|null }
        //    skyCover:          { value: number } (cloud cover percentage)
        //    shortForecast:     string description
        //    isDaytime:         boolean
        //    startTime:         ISO 8601

        /**
         * Converts NWS wind direction string to degrees.
         * @param {string} dir — Cardinal direction (N, NE, NNE, etc.)
         * @returns {number} Degrees (0-360)
         */
        function windDirToDegrees(dir) {
            const COMPASS = {
                'N': 0, 'NNE': 22.5, 'NE': 45, 'ENE': 67.5,
                'E': 90, 'ESE': 112.5, 'SE': 135, 'SSE': 157.5,
                'S': 180, 'SSW': 202.5, 'SW': 225, 'WSW': 247.5,
                'W': 270, 'WNW': 292.5, 'NW': 315, 'NNW': 337.5
            };
            return COMPASS[dir] ?? 0;
        }

        /**
         * Parses NWS wind speed string to mph number.
         * Handles "10 mph", "5 to 10 mph", "10 to 15 mph".
         * For ranges, returns the HIGHER value (conservative for alerts).
         * @param {string} windStr
         * @returns {number}
         */
        function parseWindSpeed(windStr) {
            if (!windStr || typeof windStr !== 'string') return 0;
            const matches = windStr.match(/(\d+)/g);
            if (!matches || matches.length === 0) return 0;
            // Return the higher value for ranges (conservative)
            return Math.max(...matches.map(Number));
        }

        // Parse the first 24 periods (hours)
        const maxPeriods = Math.min(periods.length, 24);
        const hourly = [];
        const skyCoverArray = [];

        for (let i = 0; i < maxPeriods; i++) {
            const p = periods[i];

            // Temperature — convert to Fahrenheit if reported in Celsius
            let tempF = p.temperature;
            if (p.temperatureUnit === 'C') {
                tempF = (p.temperature * 9 / 5) + 32;
            }
            tempF = Math.round(tempF);

            // Relative Humidity — NWS embeds this in a value/unitCode object
            const rh = p.relativeHumidity?.value ?? 50;

            // Wind
            const windMph = parseWindSpeed(p.windSpeed);
            const windDirStr = p.windDirection || 'N';
            const windDirDeg = windDirToDegrees(windDirStr);

            // Sky Cover (cloud percentage) — the key input for DLI calculation
            const skyCover = p.skyCover?.value ?? 50;
            skyCoverArray.push(skyCover);

            // Precipitation probability
            const precipProb = p.probabilityOfPrecipitation?.value ?? 0;

            hourly.push({
                startTime: p.startTime,
                tempF,
                rh,
                windMph,
                windDir: windDirStr,
                windDirDeg,
                skyCover,
                precipProb,
                shortForecast: p.shortForecast || '',
                isDaytime: p.isDaytime ?? true
            });
        }

        // ── Build the "current" snapshot from the first period ──
        const first = hourly[0] || null;
        const current = first ? {
            tempF: first.tempF,
            rh: first.rh,
            windMph: first.windMph,
            windDir: first.windDirDeg,
            skyCover: first.skyCover,
            shortForecast: first.shortForecast
        } : null;

        devLog(
            `%c 🌤️ NWS Forecast: ${hourly.length} hours from ${gridMeta.office} ` +
            `(${roundedLat}, ${roundedLon}) `,
            'background:#0369a1;color:white;font-size:11px;font-weight:bold;' +
            'padding:3px 8px;border-radius:3px;'
        );

        return {
            success: true,
            source: 'NWS',
            location: {
                lat: roundedLat,
                lon: roundedLon,
                office: gridMeta.office,
                gridX: gridMeta.gridX,
                gridY: gridMeta.gridY
            },
            fetchedAt: new Date().toISOString(),
            current,
            hourly,
            skyCoverArray,
            error: null
        };

    } catch (error) {
        console.error('[nws] Weather fetch failed:', error.message);

        return {
            success: false,
            source: 'NWS',
            location: { lat: roundedLat, lon: roundedLon },
            fetchedAt: new Date().toISOString(),
            current: null,
            hourly: [],
            skyCoverArray: [],
            error: error.message
        };
    }
}


// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 17: DAILY LIGHT INTEGRAL (DLI) — ASTRONOMICAL ESTIMATION
// ═══════════════════════════════════════════════════════════════════════════════
//
// The Daily Light Integral (DLI) is the total amount of Photosynthetically
// Active Radiation (PAR) received by a plant canopy in a 24-hour period.
// It is THE most important metric for predicting greenhouse crop yield.
//
// Units: mol/m²/day (moles of photons per square meter per day)
//
// DLI benchmarks for common greenhouse crops:
//
//   ┌────────────────────────────────────────────────────────────────────────┐
//   │  Crop Category         │  Minimum DLI  │  Optimum DLI  │  Notes     │
//   │────────────────────────│───────────────│───────────────│────────────│
//   │  Leafy greens/herbs    │  10 mol       │  14–18 mol    │  Bolt >20 │
//   │  Seedlings/transplants │  10 mol       │  12–16 mol    │            │
//   │  Flowering crops       │  10 mol       │  20–30 mol    │  >30 max  │
//   │  Fruiting crops (🍅)   │  15 mol       │  25–40 mol    │  Yield ∝  │
//   │  CAM succulents        │   5 mol       │   8–15 mol    │  Slow     │
//   └────────────────────────────────────────────────────────────────────────┘
//
// Since we DON'T have a PAR sensor (sensor-less design), we estimate DLI
// from astronomical first principles:
//
//   1. Calculate the SOLAR DECLINATION (tilt of Earth's axis toward/away
//      from the sun) based on day of year.
//
//   2. Calculate the HOUR ANGLE at sunrise/sunset based on latitude and
//      declination. This gives us daylength.
//
//   3. Calculate EXTRATERRESTRIAL RADIATION (Ra) — the amount of PAR that
//      would reach a horizontal surface at the top of the atmosphere.
//
//   4. Apply ATMOSPHERIC TRANSMITTANCE using the Ångström-Prescott model:
//      Rs = Ra × (a + b × (n/N))
//      Where n/N is the sunshine fraction = 1 - (skyCover/100)
//
//   5. Convert solar radiation (W/m²) to PAR (µmol/m²/s) using the
//      standard conversion: 1 W/m² ≈ 2.1 µmol/m²/s of PAR
//
//   6. Integrate over daylength hours and convert to mol/m²/day.
//
// Sources:
//   - Allen et al. (1998) FAO Irrigation & Drainage Paper No. 56
//   - Monteith & Unsworth (2013) Principles of Environmental Physics, 4th ed
//   - Faust & Logan (2018) DLI Maps for the United States, HortScience
//
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Degrees to radians conversion.
 * @param {number} deg — Degrees
 * @returns {number} Radians
 */
function degToRad(deg) {
    return deg * (Math.PI / 180);
}

/**
 * Radians to degrees conversion.
 * @param {number} rad — Radians
 * @returns {number} Degrees
 */
function radToDeg(rad) {
    return rad * (180 / Math.PI);
}

/**
 * Calculates the estimated Daily Light Integral (DLI) using astronomical
 * proxy methods and NWS sky cover data.
 *
 * This function implements the FAO-56 Ångström-Prescott method for
 * estimating solar radiation from sunshine duration, adapted to use
 * NWS cloud cover percentages as the atmospheric attenuation factor.
 *
 * @param {number} lat — Latitude in decimal degrees (negative for southern hemisphere)
 * @param {number} dayOfYear — Day of year (1-366). January 1 = 1, December 31 = 365/366.
 * @param {number[]} skyCoverArray — Array of sky cover percentages (0-100) from
 *   the NWS hourly forecast. Each element represents one hour. The function uses
 *   the DAYTIME hours only (based on calculated sunrise/sunset).
 *
 * @returns {object} DLI estimation:
 *   {
 *     dli_mol:            number, — Estimated DLI (mol/m²/day)
 *     clearSkyDLI_mol:    number, — Maximum possible DLI if clear sky all day
 *     cloudReduction:     number, — Fraction of DLI lost to clouds (0-1)
 *     daylengthHours:     number, — Astronomical daylength
 *     solarDeclination:   number, — Solar declination angle (degrees)
 *     maxPAR_umol:        number, — Peak clear-sky PAR (µmol/m²/s) at solar noon
 *     avgSkyCover:        number, — Average cloud cover for daytime hours (%)
 *     category:           string, — DLI category for crop guidance
 *     Ra_MJ:              number  — Extraterrestrial radiation (MJ/m²/day)
 *   }
 *
 * @example
 *   // Nobleboro, Maine on June 21 (summer solstice) with partly cloudy skies
 *   const result = calculateEstimatedDLI(44.0784, 172, [30, 40, 50, 30, 20, ...]);
 *   console.log(`Estimated DLI: ${result.dli_mol.toFixed(1)} mol/m²/day`);
 */
export function calculateEstimatedDLI(lat, dayOfYear, skyCoverArray) {

    // ── Input validation ──
    if (typeof lat !== 'number' || lat < -90 || lat > 90) {
        throw new Error(`calculateEstimatedDLI(): Invalid latitude: ${lat}`);
    }
    if (typeof dayOfYear !== 'number' || dayOfYear < 1 || dayOfYear > 366) {
        throw new Error(`calculateEstimatedDLI(): Invalid dayOfYear: ${dayOfYear}`);
    }

    // ═══════════════════════════════════════════════════════════════════
    //  STEP 1: SOLAR DECLINATION
    // ═══════════════════════════════════════════════════════════════════
    //
    //  The solar declination δ is the angle between the Sun's rays and
    //  the plane of the Earth's equator. It varies from +23.45° on the
    //  summer solstice to -23.45° on the winter solstice.
    //
    //  Formula (Spencer, 1971 — accurate to ±0.4°):
    //    δ = 23.45° × sin( 2π × (284 + DOY) / 365 )
    //
    //  This is the driver for ALL seasonal variation in DLI.

    const solarDeclination = 23.45 * Math.sin(degToRad(360 * (284 + dayOfYear) / 365));
    const declinationRad = degToRad(solarDeclination);
    const latRad = degToRad(lat);

    // ═══════════════════════════════════════════════════════════════════
    //  STEP 2: SUNSET HOUR ANGLE & DAYLENGTH
    // ═══════════════════════════════════════════════════════════════════
    //
    //  The sunset hour angle ωs determines when the sun crosses the
    //  horizon. Daylength = 2 × ωs / 15 (in hours).
    //
    //  cos(ωs) = -tan(φ) × tan(δ)
    //
    //  Special cases:
    //    - If cos(ωs) > 1  → polar night (sun never rises)
    //    - If cos(ωs) < -1 → midnight sun (sun never sets)

    let cosOmega = -Math.tan(latRad) * Math.tan(declinationRad);

    // Clamp for polar edge cases
    let daylengthHours;
    if (cosOmega >= 1) {
        // Polar night — no daylight
        daylengthHours = 0;
    } else if (cosOmega <= -1) {
        // Midnight sun — 24 hours of daylight
        daylengthHours = 24;
    } else {
        const sunsetHourAngle = radToDeg(Math.acos(cosOmega));
        daylengthHours = (2 * sunsetHourAngle) / 15;
    }

    // ═══════════════════════════════════════════════════════════════════
    //  STEP 3: EXTRATERRESTRIAL RADIATION (Ra)
    // ═══════════════════════════════════════════════════════════════════
    //
    //  Ra is the solar radiation at the top of the atmosphere.
    //  This is the MAXIMUM possible radiation before atmospheric losses.
    //
    //  FAO-56 Equation 21:
    //    Ra = (24 × 60 / π) × Gsc × dr × [ωs×sin(φ)×sin(δ) + cos(φ)×cos(δ)×sin(ωs)]
    //
    //  Where:
    //    Gsc = Solar constant = 0.0820 MJ/m²/min
    //    dr = Inverse relative distance Earth-Sun = 1 + 0.033×cos(2π×DOY/365)

    const Gsc = 0.0820; // MJ/m²/min (solar constant)
    const dr = 1 + 0.033 * Math.cos(degToRad(360 * dayOfYear / 365));

    let Ra_MJ; // MJ/m²/day

    if (daylengthHours <= 0) {
        Ra_MJ = 0;
    } else if (daylengthHours >= 24) {
        // Midnight sun approximation: use full circular integral
        const omegaS_rad = Math.PI; // 180° = full hemisphere
        Ra_MJ = (24 * 60 / Math.PI) * Gsc * dr *
            (omegaS_rad * Math.sin(latRad) * Math.sin(declinationRad) +
             Math.cos(latRad) * Math.cos(declinationRad) * Math.sin(omegaS_rad));
    } else {
        const omegaS_rad = Math.acos(cosOmega);
        Ra_MJ = (24 * 60 / Math.PI) * Gsc * dr *
            (omegaS_rad * Math.sin(latRad) * Math.sin(declinationRad) +
             Math.cos(latRad) * Math.cos(declinationRad) * Math.sin(omegaS_rad));
    }

    // Ensure non-negative
    Ra_MJ = Math.max(0, Ra_MJ);

    // ═══════════════════════════════════════════════════════════════════
    //  STEP 4: ATMOSPHERIC TRANSMITTANCE (Ångström-Prescott)
    // ═══════════════════════════════════════════════════════════════════
    //
    //  The Ångström-Prescott equation relates actual solar radiation (Rs)
    //  to extraterrestrial radiation (Ra) using the sunshine fraction:
    //
    //    Rs = Ra × (a_s + b_s × n/N)
    //
    //  Where:
    //    a_s = 0.25 (fraction of Ra reaching Earth on overcast days)
    //    b_s = 0.50 (additional fraction on completely clear days)
    //    n/N = sunshine fraction = 1 - (avgSkyCover / 100)
    //
    //  These are the FAO-56 recommended defaults when no calibrated
    //  regional values are available.
    //
    //  NWS sky cover replaces traditional sunshine-hour measurements:
    //    0% sky cover → n/N = 1.0 (full sunshine)
    //    100% sky cover → n/N = 0.0 (complete overcast)

    // Calculate average sky cover for DAYTIME hours only
    const dayHours = Math.round(daylengthHours);
    let avgSkyCover;

    if (Array.isArray(skyCoverArray) && skyCoverArray.length > 0 && dayHours > 0) {
        // Use only the first dayHours entries (approximate daytime window)
        const daytimeSamples = skyCoverArray.slice(0, Math.min(skyCoverArray.length, dayHours));
        avgSkyCover = daytimeSamples.reduce((sum, v) => sum + (v || 0), 0) / daytimeSamples.length;
    } else {
        avgSkyCover = 50; // Default to partly cloudy if no data
    }

    const sunshineFraction = 1 - (avgSkyCover / 100);
    const a_s = 0.25;
    const b_s = 0.50;

    // Actual solar radiation at ground level (MJ/m²/day)
    const Rs_MJ = Ra_MJ * (a_s + b_s * sunshineFraction);

    // ═══════════════════════════════════════════════════════════════════
    //  STEP 5: CONVERT SOLAR RADIATION TO PAR → DLI
    // ═══════════════════════════════════════════════════════════════════
    //
    //  Solar radiation → PAR conversion:
    //    PAR ≈ 45% of total solar radiation (400-700nm band)
    //    1 MJ/m²/day of PAR = 4.57 mol/m²/day of photons
    //
    //  Combined conversion:
    //    DLI (mol/m²/day) = Rs (MJ/m²/day) × 0.45 × 4.57
    //                     = Rs × 2.0565
    //
    //  Additional glazing transmittance reduction for enclosed structures:
    //    Single poly: ~85% transmittance
    //    Double poly: ~72% transmittance
    //    Glass:       ~90% transmittance
    //
    //  We report the UNMODIFIED outdoor DLI here. The structure-specific
    //  reduction is applied when the house glazing type is known.

    const PAR_FRACTION = 0.45;  // PAR is 45% of total solar radiation
    const MJ_TO_MOL = 4.57;    // 1 MJ PAR = 4.57 mol photons

    const dli_mol = Rs_MJ * PAR_FRACTION * MJ_TO_MOL;
    const clearSkyDLI_mol = Ra_MJ * (a_s + b_s) * PAR_FRACTION * MJ_TO_MOL;
    const cloudReduction = clearSkyDLI_mol > 0
        ? 1 - (dli_mol / clearSkyDLI_mol)
        : 0;

    //  Peak clear-sky PAR at solar noon (µmol/m²/s)
    //  This is the instantaneous maximum — useful for supplemental lighting decisions.
    //  Approximation: Ra spread over daylength, with peak at ~1.5× average.
    //  PAR (µmol/m²/s) = (Rs_MJ × 1e6 / daylength_seconds) × PAR_FRACTION × 2.1 × peak_factor
    const daylengthSec = daylengthHours * 3600;
    const maxPAR_umol = daylengthSec > 0
        ? ((Ra_MJ * (a_s + b_s) * 1e6) / daylengthSec) * PAR_FRACTION * 2.1 * 1.35
        : 0;

    // ── DLI category for crop guidance ──
    let category;
    if (dli_mol < 5)       category = 'very_low';      // Only CAM / shade crops survive
    else if (dli_mol < 10) category = 'low';            // Leafy greens minimum
    else if (dli_mol < 15) category = 'moderate_low';   // Greens adequate, fruiting marginal
    else if (dli_mol < 20) category = 'moderate';       // Most crops adequate
    else if (dli_mol < 30) category = 'good';           // Fruiting crops optimal
    else if (dli_mol < 40) category = 'high';           // Maximum fruiting yield
    else                   category = 'very_high';      // Desert / tropical conditions

    return {
        dli_mol:            parseFloat(dli_mol.toFixed(2)),
        clearSkyDLI_mol:    parseFloat(clearSkyDLI_mol.toFixed(2)),
        cloudReduction:     parseFloat(cloudReduction.toFixed(4)),
        daylengthHours:     parseFloat(daylengthHours.toFixed(2)),
        solarDeclination:   parseFloat(solarDeclination.toFixed(2)),
        maxPAR_umol:        parseFloat(maxPAR_umol.toFixed(1)),
        avgSkyCover:        parseFloat(avgSkyCover.toFixed(1)),
        category,
        Ra_MJ:              parseFloat(Ra_MJ.toFixed(2))
    };
}


// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 18: LEAF SURFACE TEMPERATURE & TRUE VPD
// ═══════════════════════════════════════════════════════════════════════════════
//
// The standard VPD calculation (Section 4) uses AIR temperature and humidity,
// which is what weather stations and most cheap sensors measure. But plants
// experience VPD at their LEAF SURFACE, where the temperature differs from
// air temperature due to:
//
//   1. TRANSPIRATION COOLING — Evaporating water from stomata absorbs latent
//      heat, cooling the leaf 2-5°F below air temperature under normal conditions.
//
//   2. SOLAR RADIATION HEATING — Direct sunlight heats the leaf surface above
//      air temperature. A fully sunlit leaf can be 10-20°F warmer than ambient.
//
//   3. WIND SPEED — Higher wind thins the boundary layer, bringing leaf
//      temperature closer to air temperature.
//
// The net effect:
//   - DAYTIME: Leaf temp > Air temp (solar heating dominates transpiration cooling)
//   - NIGHTTIME: Leaf temp < Air temp (radiative cooling, no solar input)
//   - HIGH WIND: Leaf temp ≈ Air temp (boundary layer is thin)
//   - WILTING PLANT: Leaf temp >> Air temp (no transpiration cooling!)
//
// Leaf Surface Temperature (LST) affects:
//   - True VPD at the leaf boundary layer (what the stomates "feel")
//   - Disease risk (Botrytis germination depends on leaf temp, not air temp)
//   - Frost damage (leaves freeze before air does due to radiative cooling)
//   - Pollen viability (leaf-level heat causes sterility in tomatoes)
//
// Sources:
//   - Gates (1980) Biophysical Ecology, Springer
//   - Jones (2013) Plants and Microclimate, 3rd ed., Cambridge
//   - Monteith & Unsworth (2013) Principles of Environmental Physics
//
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Estimates Leaf Surface Temperature (LST) from air conditions.
 *
 * This is a simplified energy balance model that accounts for the major
 * factors driving leaf-air temperature differential. Full energy balance
 * models require leaf absorptance, stomatal conductance, and boundary
 * layer resistance — which we don't have without sensors.
 *
 * @param {number} airTempF — Air temperature in Fahrenheit
 * @param {number} rh — Relative humidity (0-100%)
 * @param {number} solarW — Estimated solar irradiance (W/m²). Use 0 for night.
 * @param {number} windMph — Wind speed in mph
 * @param {boolean} isTranspiring — Whether the plant is actively transpiring.
 *   Set false for wilting/drought-stressed plants or CAM plants during daytime.
 *
 * @returns {object} Leaf temperature estimate:
 *   {
 *     leafTempF:    number, — Estimated leaf surface temperature (°F)
 *     leafTempC:    number, — Same in Celsius
 *     deltaF:       number, — Leaf-Air temperature difference (°F)
 *     isWarmer:     boolean, — True if leaf is warmer than air
 *     confidence:   string  — 'high' (sensor-backed) | 'moderate' (modeled) | 'low'
 *   }
 *
 * @example
 *   // Sunny day, moderate wind, healthy plant
 *   const lst = calculateLST(78, 60, 800, 5, true);
 *   // lst.leafTempF ≈ 82°F (leaf warmer than air due to solar heating)
 *
 *   // Night, calm
 *   const lstNight = calculateLST(55, 90, 0, 2, true);
 *   // lstNight.leafTempF ≈ 52°F (leaf cooler than air due to radiative cooling)
 */
export function calculateLST(airTempF, rh, solarW, windMph, isTranspiring) {

    // ── Input defaults & validation ──
    if (typeof airTempF !== 'number' || isNaN(airTempF)) {
        throw new Error(`calculateLST(): airTempF must be a number, received: ${airTempF}`);
    }
    const solar = (typeof solarW === 'number' && !isNaN(solarW)) ? Math.max(0, solarW) : 0;
    const wind = (typeof windMph === 'number' && !isNaN(windMph)) ? Math.max(0, windMph) : 0;
    const humidity = (typeof rh === 'number' && !isNaN(rh)) ? Math.min(100, Math.max(0, rh)) : 50;
    const transpiring = isTranspiring !== false; // default true

    // ═══════════════════════════════════════════════════════════════════
    //  ENERGY BALANCE COMPONENTS
    // ═══════════════════════════════════════════════════════════════════

    // 1. Solar heating effect (Rn contribution)
    //    Leaf absorptance ≈ 0.50 for PAR (photosynthetically active)
    //    A fully sunlit leaf at 1000 W/m² absorbs ~500 W/m²
    //    This heats the leaf roughly +10-15°F above air temp in still air.
    //
    //    Empirical approximation:
    //      ΔT_solar ≈ (solar × absorptance) / (boundary_layer_conductance)
    //      Simplified: ΔT_solar ≈ solar / 80  (°F, in still air)
    //      With wind: ΔT_solar ≈ solar / (80 + 15 × sqrt(wind_mph))

    const absorptance = 0.50;
    const windFactor = 80 + 15 * Math.sqrt(wind);
    const solarHeatingF = (solar * absorptance) / windFactor;

    // 2. Transpiration cooling effect
    //    Transpiration cools the leaf by evaporating water from stomata.
    //    Cooling is proportional to the vapor pressure deficit at the leaf
    //    surface and inversely proportional to humidity (high RH = less evaporation).
    //
    //    Empirical approximation:
    //      ΔT_transpiration ≈ -2 to -5°F under normal conditions
    //      Scales with (1 - RH/100): more cooling in dry air
    //      Zero cooling if plant is not transpiring (wilting, CAM daytime)

    let transpirationCoolingF = 0;
    if (transpiring) {
        const drynessFactor = 1 - (humidity / 100); // 0 (saturated) to 1 (bone dry)
        transpirationCoolingF = -3.5 * drynessFactor; // -3.5°F max cooling in dry air
    }

    // 3. Radiative cooling effect (nighttime)
    //    At night, leaves radiate longwave IR to the sky and cool below
    //    air temperature. Clear skies = maximum radiative cooling.
    //    Calm air = maximum effect (no convective mixing).
    //
    //    This is why frost forms on leaves BEFORE air temperature reaches 32°F.
    //
    //    Empirical approximation:
    //      ΔT_radiative ≈ -3 to -7°F on clear, calm nights
    //      Reduced by wind and high humidity (clouds re-radiate)

    let radiativeCoolingF = 0;
    if (solar <= 10) { // Night or deep overcast
        const clearSkyFactor = 1 - (humidity / 100) * 0.6; // Clouds reduce radiative loss
        const calmFactor = 1 / (1 + 0.3 * wind); // Wind reduces radiative cooling
        radiativeCoolingF = -5 * clearSkyFactor * calmFactor;
    }

    // ═══════════════════════════════════════════════════════════════════
    //  NET LEAF-AIR DIFFERENTIAL
    // ═══════════════════════════════════════════════════════════════════

    const deltaF = solarHeatingF + transpirationCoolingF + radiativeCoolingF;
    const leafTempF = airTempF + deltaF;
    const leafTempC = (leafTempF - 32) * 5 / 9;

    return {
        leafTempF: parseFloat(leafTempF.toFixed(1)),
        leafTempC: parseFloat(leafTempC.toFixed(2)),
        deltaF: parseFloat(deltaF.toFixed(1)),
        isWarmer: deltaF > 0,
        confidence: 'moderate' // Always 'moderate' without actual leaf temp sensor
    };
}


/**
 * Calculates the "True VPD" — the vapor pressure deficit at the leaf
 * surface, using estimated Leaf Surface Temperature instead of air temperature.
 *
 * This is the VPD that the plant's stomates actually experience. Standard
 * air-temperature VPD can underestimate the drought stress on sunlit leaves
 * by 30-50% because the leaf is warmer than the air.
 *
 * Key insight:
 *   The SVP (Saturation Vapor Pressure) is calculated at the LEAF temperature,
 *   but the AVP (Actual Vapor Pressure) is calculated at AIR temperature and
 *   humidity. This is physically correct because the water vapor in the air
 *   surrounding the leaf is at air temperature, but the leaf surface is
 *   producing vapor pressure at its own (higher or lower) temperature.
 *
 * @param {number} airTempF — Air temperature (°F)
 * @param {number} rh — Relative humidity (0-100%)
 * @param {number} solarW — Solar irradiance (W/m²). Use 0 for night.
 * @param {number} windMph — Wind speed (mph)
 * @param {boolean} [isTranspiring=true] — Whether plant is actively transpiring
 *
 * @returns {object} True VPD results:
 *   {
 *     trueVPD_kPa:   number, — VPD at the leaf surface (kPa)
 *     airVPD_kPa:    number, — Standard air-temperature VPD for comparison (kPa)
 *     vpdDelta_kPa:  number, — Difference (trueVPD - airVPD)
 *     leafTempF:     number, — Estimated leaf temperature (°F)
 *     svpLeaf_kPa:   number, — SVP at leaf temperature
 *     avpAir_kPa:    number, — AVP at air conditions
 *     deltaF:        number, — Leaf-air temperature difference (°F)
 *   }
 *
 * @example
 *   const result = calculateTrueVPD(78, 60, 800, 5, true);
 *   // result.trueVPD_kPa ≈ 1.45 (higher than air VPD due to warm leaf)
 *   // result.airVPD_kPa  ≈ 1.12 (standard VPD from air conditions)
 */
export function calculateTrueVPD(airTempF, rh, solarW, windMph, isTranspiring) {

    // ── Standard air-temperature VPD for comparison ──
    const airVPD = calculateVPD(airTempF, rh);

    // ── Estimate leaf surface temperature ──
    const lst = calculateLST(airTempF, rh, solarW, windMph, isTranspiring);

    // ── Calculate SVP at LEAF temperature (Tetens equation) ──
    //   This is the key: the leaf surface "wants" to produce vapor at its
    //   own temperature. If the leaf is hotter, the SVP is higher, meaning
    //   the VPD at the leaf surface is LARGER than the air VPD.
    const leafTempC = lst.leafTempC;
    const svpLeaf = 0.6108 * Math.exp((17.27 * leafTempC) / (leafTempC + 237.3));

    // ── AVP remains at AIR temperature ──
    //   The actual water vapor content of the air surrounding the leaf
    //   is determined by the air's temperature and humidity, not the leaf's.
    const avpAir = airVPD.avp_kPa;

    // ── True VPD at the leaf boundary layer ──
    const trueVPD = Math.max(0, svpLeaf - avpAir);

    return {
        trueVPD_kPa:  parseFloat(trueVPD.toFixed(4)),
        airVPD_kPa:   airVPD.vpd_kPa,
        vpdDelta_kPa: parseFloat((trueVPD - airVPD.vpd_kPa).toFixed(4)),
        leafTempF:    lst.leafTempF,
        svpLeaf_kPa:  parseFloat(svpLeaf.toFixed(4)),
        avpAir_kPa:   avpAir,
        deltaF:       lst.deltaF
    };
}


// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 19: SENSOR INTEGRATION — getLiveSensorData
// ═══════════════════════════════════════════════════════════════════════════════
//
// Mock sensor endpoint for local development and testing.
//
// In production, this function will:
//   1. Check house.sensorConfig.brand to determine the API to call
//   2. Use house.sensorConfig.deviceId to identify the specific sensor
//   3. Fetch real-time data from the sensor's cloud API:
//      - Davis WeatherLink: https://api.weatherlink.com/v2/
//      - Ecowitt: https://api.ecowitt.net/api/v3/
//      - SenseCap: https://sensecap.seeed.cc/openapi/
//   4. Return the data in a normalized format
//
// For now, this returns realistic mock data so the UI and physics engine
// can be developed and tested without actual hardware.
//
// The mock values simulate a typical spring day in Zone 5b:
//   - 75°F interior temp (heated greenhouse, ~60°F ambient + solar gain)
//   - 65% RH (moderate transpiration, vents cracked)
//
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Fetches live sensor data for a greenhouse structure.
 *
 * Currently returns mock data for development. In production,
 * this will dispatch to the appropriate sensor API based on
 * house.sensorConfig.brand.
 *
 * @param {object} house — House object with sensorConfig:
 *   {
 *     sensorConfig: {
 *       brand:    'davis' | 'ecowitt' | 'sensecap' | 'none',
 *       deviceId: string
 *     }
 *   }
 *
 * @returns {Promise<object>} Sensor reading:
 *   {
 *     success:   boolean,
 *     source:    string,    — 'mock' | 'davis' | 'ecowitt' | 'sensecap'
 *     tempF:     number,    — Interior temperature (°F)
 *     rh:        number,    — Interior relative humidity (%)
 *     timestamp: number,    — Reading timestamp (ms since epoch)
 *     deviceId:  string,    — Sensor device identifier
 *     error:     string|null
 *   }
 *
 * @example
 *   const sensor = await getLiveSensorData(house);
 *   if (sensor.success) {
 *     const vpd = calculateVPD(sensor.tempF, sensor.rh);
 *     devLog(`Sensor VPD: ${vpd.vpd_kPa.toFixed(2)} kPa`);
 *   }
 */
export async function getLiveSensorData(house) {

    const config = house?.sensorConfig || { brand: 'none', deviceId: '' };

    // ── Guard: no sensor configured ──
    if (!config.brand || config.brand === 'none') {
        return {
            success: false,
            source: 'none',
            tempF: null,
            rh: null,
            timestamp: Date.now(),
            deviceId: config.deviceId || '',
            error: 'No sensor configured for this structure. ' +
                   'Using NWS forecast + physics model for estimates.'
        };
    }

    // ═══════════════════════════════════════════════════════════════════
    //  PRODUCTION DISPATCH (stub — to be implemented per-brand)
    // ═══════════════════════════════════════════════════════════════════
    //
    //  When a real sensor brand is configured but we don't have the
    //  production API integration yet, return mock data that simulates
    //  realistic sensor readings. This keeps the engine testable.
    //
    //  TODO: Implement real API calls for each brand:
    //    case 'davis':    → Davis WeatherLink v2 API
    //    case 'ecowitt':  → Ecowitt Open API v3
    //    case 'sensecap': → SenseCap OpenAPI

    // ── Mock data for development ──
    //   Simulates realistic interior conditions for a heated greenhouse
    //   in Zone 5b spring (March-May). Adds small random variation to
    //   prevent the UI from looking "frozen" during development.

    const baseTemp = 75;
    const baseRH = 65;
    const variation = () => (Math.random() - 0.5) * 4; // ±2°F jitter

    const mockTemp = parseFloat((baseTemp + variation()).toFixed(1));
    const mockRH = Math.round(Math.min(99, Math.max(30, baseRH + variation() * 3)));

    devLog(
        `%c 📡 Sensor [${config.brand}/${config.deviceId || 'unknown'}] ` +
        `→ MOCK: ${mockTemp}°F / ${mockRH}% RH `,
        'background:#7c3aed;color:white;font-size:11px;font-weight:bold;' +
        'padding:3px 8px;border-radius:3px;'
    );

    return {
        success: true,
        source: 'mock',
        tempF: mockTemp,
        rh: mockRH,
        timestamp: Date.now(),
        deviceId: config.deviceId || 'mock-device-001',
        error: null
    };
}


// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 20: INTELLIGENT FAILSAFE ENGINE — getIntelligentHouseRecommendation
// ═══════════════════════════════════════════════════════════════════════════════
//
// This is the MASTER ORCHESTRATOR for the Greenhouse OS physics engine.
// It ties together every subsystem into a single async call that:
//
//   1. Attempts to read LIVE SENSOR DATA from the house's hardware
//   2. Falls back to NWS forecast data if sensors are offline
//   3. Calculates TRUE LEAF-SURFACE VPD (not standard air VPD)
//   4. Estimates Daily Light Integral (DLI) from astronomical models
//   5. Applies CROP-TYPE-SPECIFIC LOGIC (C3 fruiting vs C3 leafy vs CAM)
//   6. Applies CLIMATE-PROFILE-SPECIFIC LOGIC (desert EC flush, etc.)
//   7. Runs the existing 9-gate recommendation cascade
//   8. Enriches the cascade output with sensor telemetry and DLI data
//
// Hardware Failsafe Priority:
//
//   ┌─────────────────────────────────────────────────────────────────────────┐
//   │  Priority  │  Source              │  telemetryStatus   │  Conditions  │
//   │────────────│──────────────────────│────────────────────│──────────────│
//   │  1 (best)  │  Live sensor data    │  'live'            │  Fresh <60m, │
//   │            │                      │                    │  !isReadOnly │
//   │  2         │  NWS hourly forecast │  'fallback_nws'    │  API success │
//   │  3         │  Raw weather input   │  'fallback_manual' │  Always avail│
//   └─────────────────────────────────────────────────────────────────────────┘
//
// C3/CAM Crop Logic:
//
//   C3 FRUITING (tomatoes, peppers, cucumbers):
//     - Target VPD: 0.8–1.2 kPa (phase-adjusted via getVPDStatus)
//     - VPD < 0.4 → BOTRYTIS PURGE: simultaneous vent + heat
//     - VPD > 2.0 → MITE EXPLOSION: shade + mist + reduce ventilation
//
//   C3 LEAFY (lettuce, kale, herbs):
//     - Target VPD: 0.4–1.0 kPa
//     - Bolt risk if DLI > 20 mol/m²/day (excessive light)
//     - More tolerant of low VPD (less Botrytis susceptibility)
//
//   CAM SUCCULENT (cacti, agave, aloe):
//     - REVERSED day/night logic:
//       NIGHT: Stomata OPEN → need CO₂ access → open vents if VPD < 0.6
//       DAY:   Stomata CLOSED → conserve water → close vents to reduce loss
//     - CO₂ enrichment is ONLY useful at night (daytime = wasted gas)
//     - Lower VPD tolerance overall (0.3–1.2 kPa)
//
// Climate-Specific Logic:
//
//   hot_arid_desert + VPD > 1.6:
//     EC FLUSH WARNING — root zone salts concentrate rapidly when VPD is high
//     because transpiration draws pure water from the root zone, leaving salts
//     behind. If EC rises above ~3.0 mS/cm, osmotic stress prevents root uptake.
//     Action: flush with 0.5 EC water to leach accumulated salts.
//
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Maximum age for sensor data to be considered "fresh" (milliseconds).
 * Sensor readings older than this are discarded and we fall back to NWS.
 *
 * 60 minutes = 3,600,000 ms
 *
 * Rationale: Greenhouse conditions change slowly relative to outdoor weather.
 * A 30-minute-old interior reading is still highly representative. 60 minutes
 * is the conservative outer bound — beyond that, ambient conditions have likely
 * shifted enough that the reading could be misleading.
 */
const SENSOR_FRESHNESS_THRESHOLD_MS = 60 * 60 * 1000;

/**
 * The master recommendation orchestrator. Integrates sensor hardware,
 * NWS forecast fallback, C3/CAM crop logic, climate-specific alerts,
 * true leaf-surface VPD, and DLI estimation into a single unified output.
 *
 * @param {object} house — Greenhouse structure object (v14 schema).
 *   Must include: id, name, width, length, glazing, heating, orientation,
 *   crops[], cropType, sensorConfig, growthPhase, plantDate,
 *   leafWetnessHours, gddThrips, gddWhitefly
 *
 * @param {object} weather — Baseline weather data (from NWS or manual input).
 *   { tempF, rh, windMph, windDir }
 *
 * @param {object} appState — The application state atom (see Section 10).
 *   Used for: .isReadOnly, .globalSettings.climateProfile,
 *             .globalSettings.lat, .globalSettings.lon
 *
 * @returns {Promise<object>} Comprehensive recommendation:
 *   {
 *     rec: object,               — Full 9-gate recommendation from getHouseRecommendation
 *     trueVpd: object,           — True leaf-surface VPD result (calculateTrueVPD)
 *     dli: object,               — Daily Light Integral estimation (calculateEstimatedDLI)
 *     telemetryStatus: string,   — 'live' | 'fallback_nws' | 'fallback_manual'
 *     isReadOnly: boolean,       — Whether the user is in read-only (expired) mode
 *     sensorReading: object|null,— Raw sensor data (if available)
 *     cropTypeProfile: object|null, — Full photosynthetic crop type profile
 *     climateProfile: object|null,  — Full climate profile data
 *     enrichedAlerts: Array<{       — Additional crop/climate-specific alerts
 *       level: string,
 *       icon: string,
 *       msg: string,
 *       source: string
 *     }>,
 *     weatherUsed: object,       — The weather data actually used (sensor or NWS)
 *     timestamp: string          — ISO 8601 evaluation time
 *   }
 *
 * @example
 *   const result = await getIntelligentHouseRecommendation(
 *     state.houses[0],
 *     nwsWeather.current,
 *     state
 *   );
 *
 *   console.log(`Status: ${result.telemetryStatus}`);
 *   console.log(`True VPD: ${result.trueVpd.trueVPD_kPa} kPa`);
 *   console.log(`DLI: ${result.dli.dli_mol} mol/m²/day`);
 *   result.enrichedAlerts.forEach(a => console.log(`${a.icon} ${a.msg}`));
 */
export async function getIntelligentHouseRecommendation(house, weather, appState) {

    // ── Input guards ──
    if (!house || !weather || typeof weather.tempF !== 'number') {
        return {
            rec: null, trueVpd: null, dli: null,
            telemetryStatus: 'error',
            isReadOnly: appState?.isReadOnly ?? false,
            sensorReading: null, cropTypeProfile: null, climateProfile: null,
            enrichedAlerts: [{ level: 'critical', icon: '⛔', msg: 'Invalid input: house or weather data missing.', source: 'failsafe' }],
            weatherUsed: weather || {},
            timestamp: new Date().toISOString()
        };
    }

    const isReadOnly = appState?.isReadOnly ?? false;
    const climateKey = appState?.globalSettings?.climateProfile || 'cold_humid_interior';
    const lat = appState?.globalSettings?.lat ?? 44.0784;
    const lon = appState?.globalSettings?.lon ?? -69.4892;

    // Resolve crop type and climate profiles from data dictionaries
    const cropType = house.cropType || 'c3_fruiting';
    const cropTypeProfile = PHOTOSYNTHETIC_CROP_TYPES[cropType] || PHOTOSYNTHETIC_CROP_TYPES.c3_fruiting;
    const climateProfile = CLIMATE_PROFILES[climateKey] || CLIMATE_PROFILES.cold_humid_interior;

    const enrichedAlerts = [];

    // ═══════════════════════════════════════════════════════════════════════
    //  STEP 1: HARDWARE FAILSAFE — Sensor vs. NWS Fallback
    // ═══════════════════════════════════════════════════════════════════════
    //
    //  Priority:
    //    1. Live sensor data (< 60 minutes old AND user is not read-only)
    //    2. NWS forecast data (already provided as `weather`)
    //    3. Raw `weather` input as-is (manual fallback)
    //
    //  If sensor returns fresh data, we OVERWRITE the NWS air temp and RH
    //  with actual interior readings. This gives us TRUE interior conditions
    //  instead of estimated-from-exterior predictions.

    let telemetryStatus = 'fallback_manual';
    let weatherUsed = { ...weather }; // Clone to avoid mutation
    let sensorReading = null;

    try {
        sensorReading = await getLiveSensorData(house);

        if (sensorReading.success &&
            sensorReading.tempF !== null &&
            sensorReading.rh !== null &&
            !isReadOnly) {

            // Check freshness — reject stale readings
            const age = Date.now() - (sensorReading.timestamp || 0);

            if (age < SENSOR_FRESHNESS_THRESHOLD_MS) {
                // ── LIVE SENSOR DATA ──
                //   Overwrite the NWS exterior conditions with actual interior readings.
                //   Keep wind data from NWS (sensors don't measure outdoor wind).
                weatherUsed.tempF = sensorReading.tempF;
                weatherUsed.rh = sensorReading.rh;
                telemetryStatus = 'live';

                enrichedAlerts.push({
                    level: 'ok', icon: '📡',
                    msg: `Live sensor active [${sensorReading.source}/${sensorReading.deviceId}]. ` +
                         `Interior: ${sensorReading.tempF}°F / ${sensorReading.rh}% RH.`,
                    source: 'sensor'
                });

            } else {
                // Sensor data is stale — fall back
                telemetryStatus = 'fallback_nws';
                enrichedAlerts.push({
                    level: 'advisory', icon: '⏱️',
                    msg: `Sensor data stale (${Math.round(age / 60000)} min old > 60 min threshold). ` +
                         `Falling back to NWS forecast.`,
                    source: 'sensor'
                });
            }

        } else if (sensorReading.success && isReadOnly) {
            // Sensor is working but user is in read-only mode
            // Still USE the sensor data for calculations (read is always allowed)
            // but flag that writes are blocked
            weatherUsed.tempF = sensorReading.tempF;
            weatherUsed.rh = sensorReading.rh;
            telemetryStatus = 'live';

            enrichedAlerts.push({
                level: 'advisory', icon: '🔒',
                msg: `Sensor active but account is READ-ONLY. Data visible, cloud writes blocked. ` +
                     `Renew subscription to resume sync.`,
                source: 'subscription'
            });

        } else {
            // Sensor failed or not configured — use NWS/manual
            telemetryStatus = 'fallback_nws';
        }

    } catch (sensorErr) {
        // Sensor fetch crashed — degrade gracefully
        telemetryStatus = 'fallback_nws';
        console.warn('[failsafe] Sensor fetch failed, using NWS fallback:', sensorErr.message);
    }


    // ═══════════════════════════════════════════════════════════════════════
    //  STEP 2: CALCULATE TRUE LEAF-SURFACE VPD
    // ═══════════════════════════════════════════════════════════════════════
    //
    //  The standard 9-gate cascade uses air-temperature VPD (calculateVPD).
    //  Here we also compute the TRUE leaf-surface VPD using the energy
    //  balance model (calculateTrueVPD). This gives us two VPD values:
    //
    //    airVPD:  What the sensor/weather station measures (ambient)
    //    trueVPD: What the plant's stomates actually experience (leaf surface)
    //
    //  The difference between these two values is a powerful diagnostic:
    //    - trueVPD >> airVPD: Leaf is much hotter than air (sunlit, wilting?)
    //    - trueVPD << airVPD: Leaf is much cooler than air (night radiative cooling)
    //    - trueVPD ≈ airVPD:  Windy conditions, thin boundary layer

    const hour = new Date().getHours();
    const isNight = hour >= 19 || hour < 7;
    const isDaytime = !isNight;

    // Estimate current solar irradiance (rough proxy from time of day)
    // This is a coarse sinusoidal approximation — replaced by DLI calc below
    let estSolarW = 0;
    if (isDaytime) {
        // Simple sinusoidal solar proxy: peaks at solar noon (~12:30)
        // Solar angle factor: sin(π × (hour - 6) / 13) for daylight hours 6-19
        const solarAngle = Math.sin(Math.PI * (hour - 6) / 13);
        const peakSolar = climateProfile.avgPeakSolar || 900;
        estSolarW = Math.max(0, solarAngle * peakSolar);
    }

    // Determine if this crop type transpires during the day
    // CAM plants: stomata CLOSED during day → no transpiration → isTranspiring = false
    const isCAM = cropTypeProfile.pathway === 'CAM';
    const isTranspiring = isCAM ? isNight : isDaytime;

    const trueVpd = calculateTrueVPD(
        weatherUsed.tempF,
        weatherUsed.rh,
        estSolarW,
        weatherUsed.windMph || 0,
        isTranspiring
    );


    // ═══════════════════════════════════════════════════════════════════════
    //  STEP 3: ESTIMATE DAILY LIGHT INTEGRAL (DLI)
    // ═══════════════════════════════════════════════════════════════════════
    //
    //  DLI requires the day-of-year and sky cover data. If we have NWS
    //  forecast data, use the sky cover array. Otherwise, estimate from
    //  the climate profile's dominant humidity characteristics.

    const now = new Date();
    const startOfYear = new Date(now.getFullYear(), 0, 0);
    const diff = now - startOfYear;
    const dayOfYear = Math.floor(diff / (1000 * 60 * 60 * 24));

    // Build sky cover array — use NWS if available, else estimate from weather
    let skyCoverArray = [];
    if (weatherUsed.skyCover !== undefined) {
        // Single sky cover value — replicate for daylength estimate
        const estDayHours = 12; // rough fallback
        skyCoverArray = new Array(estDayHours).fill(weatherUsed.skyCover);
    } else {
        // Estimate from RH as a rough proxy (higher RH ≈ more clouds)
        // This is very coarse but better than nothing
        const rhProxy = Math.min(100, Math.max(0, weatherUsed.rh || 50));
        const estimatedSkyCover = Math.round(rhProxy * 0.8); // RH 80% → ~64% cover
        skyCoverArray = new Array(12).fill(estimatedSkyCover);
    }

    const dli = calculateEstimatedDLI(lat, dayOfYear, skyCoverArray);


    // ═══════════════════════════════════════════════════════════════════════
    //  STEP 4: RUN THE 9-GATE RECOMMENDATION CASCADE
    // ═══════════════════════════════════════════════════════════════════════
    //
    //  Feed the (potentially sensor-overridden) weather into the existing
    //  getHouseRecommendation engine. This gives us the full 9-gate output
    //  with wind, VPD, frost, overheating, and pest alerts.

    const rec = getHouseRecommendation(house, weatherUsed);


    // ═══════════════════════════════════════════════════════════════════════
    //  STEP 5: CROP-TYPE-SPECIFIC LOGIC (C3 / CAM)
    // ═══════════════════════════════════════════════════════════════════════
    //
    //  This is where photosynthetic pathway fundamentally changes the
    //  recommendation logic. C3 and CAM plants have OPPOSITE strategies.

    const activeVPD = trueVpd.trueVPD_kPa;

    if (isCAM) {
        // ─────────────────────────────────────────────────────────────────
        //  CAM SUCCULENT — REVERSED DAY/NIGHT LOGIC
        // ─────────────────────────────────────────────────────────────────
        //
        //  CAM plants open stomata at NIGHT to fix CO₂ (as malic acid).
        //  During the day, stomata are CLOSED — no gas exchange, no
        //  transpiration, no water loss.
        //
        //  This INVERTS the standard greenhouse ventilation strategy:
        //
        //    NIGHT (stomata open):
        //      - Plant NEEDS atmospheric CO₂ access
        //      - If VPD < 0.6 → open vents to allow CO₂ exchange
        //      - Fresh air flow brings CO₂ to the canopy
        //      - Low VPD is GOOD (less water loss during gas exchange)
        //
        //    DAY (stomata closed):
        //      - Plant is running internal Calvin cycle
        //      - Vents should be CLOSED to conserve water
        //      - No benefit from atmospheric CO₂ (stomata sealed)
        //      - Shade cloth protects from UV damage
        //
        //  CO₂ enrichment note:
        //    Pumping CO₂ during the DAY is WASTED on CAM plants.
        //    If enriching, do it at NIGHT when stomata are open.

        if (isNight && activeVPD < 0.6) {
            enrichedAlerts.push({
                level: 'advisory', icon: '🌵',
                msg: `CAM NIGHT PROTOCOL: VPD ${activeVPD.toFixed(2)} kPa < 0.6. ` +
                     `Stomata OPEN — crack vents 10-15% for CO₂ exchange. ` +
                     `Low VPD is acceptable (reduces transpiration loss).`,
                source: 'cam_logic'
            });
        }

        if (isDaytime) {
            enrichedAlerts.push({
                level: 'advisory', icon: '🌵',
                msg: `CAM DAY PROTOCOL: Stomata CLOSED. Minimize ventilation to conserve water. ` +
                     `CO₂ enrichment during daytime is WASTED on CAM plants. ` +
                     `Deploy shade cloth if solar > 300 µmol PPFD.`,
                source: 'cam_logic'
            });
        }

        // CO₂ enrichment timing warning
        if (isDaytime && activeVPD > 1.2) {
            enrichedAlerts.push({
                level: 'warning', icon: '💧',
                msg: `CAM WATER STRESS: VPD ${activeVPD.toFixed(2)} kPa > 1.2. ` +
                     `Despite closed stomata, cuticular water loss increases with VPD. ` +
                     `Deploy shade cloth and increase soil moisture.`,
                source: 'cam_logic'
            });
        }

    } else if (cropType === 'c3_fruiting') {
        // ─────────────────────────────────────────────────────────────────
        //  C3 FRUITING — HIGH-VALUE THERMOPHILIC CROPS
        // ─────────────────────────────────────────────────────────────────
        //
        //  Target VPD: 0.8–1.2 kPa (vegetative phase)
        //              1.2–1.6 kPa (flowering — drives calcium transport)
        //
        //  Critical thresholds:
        //    VPD < 0.4 → BOTRYTIS PURGE (vent + heat simultaneously)
        //    VPD > 2.0 → Mite explosion (handled in Gate 4)

        if (activeVPD < 0.4) {
            // ── BOTRYTIS PURGE PROTOCOL ──
            //
            // This is the #1 disease management action in humid climates.
            // When VPD drops below 0.4, the dew point depression is so small
            // that free water is imminent. Botrytis cinerea (gray mold)
            // germinates in 4-6 hours of sustained leaf wetness at these VPD levels.
            //
            // The PURGE combines two actions simultaneously:
            //   1. VENT — crack leeward side 2 inches to exhaust moisture
            //   2. HEAT — run propane heater to spike air temperature
            //
            // Why BOTH? Venting alone brings in cold, humid outside air.
            // Heating alone doesn't remove moisture from the structure.
            // The combination raises air temperature (raising SVP) WHILE
            // exhausting the most humid air from the peak canopy.
            //
            // Duration: 20-30 minutes, check VPD, repeat if needed.
            // Energy cost: ~$0.50-1.00 per purge cycle (propane at $2.50/gal)

            enrichedAlerts.push({
                level: 'critical', icon: '🍄',
                msg: `BOTRYTIS PURGE: True VPD ${activeVPD.toFixed(2)} kPa < 0.4. ` +
                     `Free water forming on leaf surfaces. VENT leeward 2" AND RUN HEAT ` +
                     `simultaneously for 20-30 min. Leaf temp Δ: ${trueVpd.deltaF}°F. ` +
                     `This is the #1 crop loss scenario for C3 fruiting crops.`,
                source: 'c3_logic'
            });
        }

        if (activeVPD > 1.6 && activeVPD <= 2.0) {
            enrichedAlerts.push({
                level: 'advisory', icon: '🌡️',
                msg: `C3 STRESS ZONE: True VPD ${activeVPD.toFixed(2)} kPa approaching mite threshold (2.0). ` +
                     `Stomatal resistance increasing — photosynthesis declining. ` +
                     `Consider misting or shade cloth to pull VPD back below 1.2.`,
                source: 'c3_logic'
            });
        }

        // Photorespiration warning for C3 fruiting crops at high temps
        if (weatherUsed.tempF > 85) {
            enrichedAlerts.push({
                level: 'warning', icon: '🧬',
                msg: `PHOTORESPIRATION: Interior ${weatherUsed.tempF}°F > 85°F. ` +
                     `RuBisCO is fixing O₂ instead of CO₂, wasting 25-40% of fixed carbon. ` +
                     `Tomato yield DROPS above 85°F even with ample light. COOL the structure.`,
                source: 'c3_logic'
            });
        }

    } else if (cropType === 'c3_leafy') {
        // ─────────────────────────────────────────────────────────────────
        //  C3 LEAFY — COOL-SEASON, BOLT-SENSITIVE CROPS
        // ─────────────────────────────────────────────────────────────────

        if (weatherUsed.tempF > 75) {
            enrichedAlerts.push({
                level: 'warning', icon: '🥬',
                msg: `BOLT RISK: Interior ${weatherUsed.tempF}°F > 75°F. ` +
                     `Lettuce and spinach will initiate flowering hormone cascade. ` +
                     `Open vents, deploy shade cloth, or mist to drop below 70°F.`,
                source: 'c3_leafy_logic'
            });
        }

        // DLI too high for leafy crops → bolt trigger
        if (dli.dli_mol > 20) {
            enrichedAlerts.push({
                level: 'advisory', icon: '☀️',
                msg: `EXCESSIVE DLI: ${dli.dli_mol.toFixed(1)} mol/m²/day > 20 mol threshold for leafy crops. ` +
                     `Deploy 30-40% shade cloth to prevent bolting. ` +
                     `C3 leafy crops saturate at 400 µmol PPFD.`,
                source: 'c3_leafy_logic'
            });
        }
    }


    // ═══════════════════════════════════════════════════════════════════════
    //  STEP 6: CLIMATE-PROFILE-SPECIFIC LOGIC
    // ═══════════════════════════════════════════════════════════════════════

    // ── Desert EC Flush Warning ──
    //
    //  In hot arid desert climates, high VPD drives extreme transpiration.
    //  Each liter of water the plant transpires leaves its dissolved salts
    //  behind in the root zone. Over a single hot day (VPD > 1.6), the
    //  effective EC (Electrical Conductivity) of the root zone can double.
    //
    //  If root zone EC exceeds ~3.0 mS/cm, osmotic stress begins. The
    //  salt concentration OUTSIDE the roots equals the concentration
    //  INSIDE, so the plant can no longer extract water via osmosis.
    //  Visible symptoms: leaf tip burn, wilting despite wet soil.
    //
    //  Treatment: Flush the root zone with LOW EC water (0.5 mS/cm or less)
    //  at 2-3× the normal irrigation volume to leach accumulated salts
    //  below the root zone.
    //
    //  Source: UA-CEA desert greenhouse management guides

    if (climateKey === 'hot_arid_desert' && activeVPD > 1.6) {
        enrichedAlerts.push({
            level: 'warning', icon: '🏜️',
            msg: `EC FLUSH WARNING (Desert Protocol): VPD ${activeVPD.toFixed(2)} kPa > 1.6. ` +
                 `Extreme transpiration is concentrating root zone salts. ` +
                 `Flush irrigation lines with 0.5 EC water at 2-3× normal volume. ` +
                 `Check runoff EC — target < 2.5 mS/cm. Failure to flush risks osmotic lockout.`,
            source: 'climate_logic'
        });
    }

    // ── Arctic supplemental lighting reminder ──
    if (climateKey === 'arctic_cryosphere' && dli.dli_mol < 8) {
        enrichedAlerts.push({
            level: 'warning', icon: '💡',
            msg: `ARCTIC LIGHT DEFICIENCY: DLI ${dli.dli_mol.toFixed(1)} mol/m²/day < 8 mol minimum. ` +
                 `Supplemental LED lighting (400+ µmol PPFD) mandatory for any crop production. ` +
                 `Without supplemental light, photosynthesis cannot sustain growth.`,
            source: 'climate_logic'
        });
    }

    // ── Pacific NW persistent dampness ──
    if (climateKey === 'cloudy_marine' && activeVPD < 0.5 && isDaytime) {
        enrichedAlerts.push({
            level: 'advisory', icon: '🌧️',
            msg: `MARINE DAMPNESS: VPD ${activeVPD.toFixed(2)} kPa < 0.5 despite daytime. ` +
                 `Downy Mildew and Pythium risk elevated. Run HAF fans at 3 cfm/sqft ` +
                 `and crack vents even in drizzle — air movement breaks infection cycles.`,
            source: 'climate_logic'
        });
    }

    // ── Subtropical hurricane-season structural check ──
    if (climateKey === 'subtropical' && weatherUsed.windMph > 45) {
        enrichedAlerts.push({
            level: 'critical', icon: '🌀',
            msg: `TROPICAL STORM CONDITIONS: ${Math.round(weatherUsed.windMph)} mph winds. ` +
                 `Verify ground anchor integrity and polycarbonate panel fasteners. ` +
                 `Remove loose shade cloth and retract automated vents. ` +
                 `Evacuate structure if winds exceed 75 mph.`,
            source: 'climate_logic'
        });
    }

    // ── Desert cooling system check ──
    if (climateKey === 'hot_arid_desert' && weatherUsed.tempF > 100) {
        enrichedAlerts.push({
            level: 'warning', icon: '🔥',
            msg: `EXTREME HEAT: Ambient ${weatherUsed.tempF}°F > 100°F. ` +
                 `Verify pad-and-fan evaporative cooling is operational. ` +
                 `Unmodified interior temps exceed 150°F at these ambient conditions. ` +
                 `Check cellulose pad saturation and exhaust fan airflow.`,
            source: 'climate_logic'
        });
    }


    // ═══════════════════════════════════════════════════════════════════════
    //  STEP 7: DLI-SPECIFIC ALERTS
    // ═══════════════════════════════════════════════════════════════════════

    // Supplemental lighting decision support
    if (dli.dli_mol < 10 && cropType === 'c3_fruiting') {
        enrichedAlerts.push({
            level: 'warning', icon: '💡',
            msg: `LOW DLI: ${dli.dli_mol.toFixed(1)} mol/m²/day < 10 mol minimum for fruiting crops. ` +
                 `Yield will be severely reduced. Supplemental lighting ` +
                 `(200+ µmol PPFD for ${Math.max(0, Math.round((15 - dli.dli_mol) / 2))} hrs) recommended ` +
                 `to reach target 15+ mol.`,
            source: 'dli_logic'
        });
    }

    // Glazing transmittance reminder
    if (dli.dli_mol > 0 && house.glazing === 'double') {
        const adjustedDLI = (dli.dli_mol * 0.72).toFixed(1);
        enrichedAlerts.push({
            level: 'advisory', icon: '🔍',
            msg: `GLAZING LOSS: Double-poly reduces DLI from ${dli.dli_mol} → ~${adjustedDLI} mol/m²/day ` +
                 `(72% transmittance). Single-poly would deliver ~${(dli.dli_mol * 0.85).toFixed(1)} mol (85%).`,
            source: 'dli_logic'
        });
    }


    // ═══════════════════════════════════════════════════════════════════════
    //  STEP 8: ASSEMBLE FINAL OUTPUT
    // ═══════════════════════════════════════════════════════════════════════

    devLog(
        `%c 🧠 Intelligent Rec: ${house.name || house.id} | ` +
        `${telemetryStatus} | TrueVPD: ${activeVPD.toFixed(2)} kPa | ` +
        `DLI: ${dli.dli_mol} mol | ${cropType} | ${climateKey} | ` +
        `${enrichedAlerts.length} enriched alerts `,
        'background:#0f172a;color:#38bdf8;font-size:11px;font-weight:bold;' +
        'padding:3px 8px;border-radius:3px;'
    );

    return {
        rec,
        trueVpd,
        dli,
        telemetryStatus,
        isReadOnly,
        sensorReading,
        cropTypeProfile,
        climateProfile,
        enrichedAlerts,
        weatherUsed,
        timestamp: new Date().toISOString()
    };
}


// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 21: GLOBAL NAMESPACE EXPORT — window.app
// ═══════════════════════════════════════════════════════════════════════════════
//
// In the single-file HTML deployment (greenhouse-command.html), the engine
// is loaded via a <script> tag, NOT as an ES module import. Browser globals
// are the only way to make these functions accessible to the UI layer.
//
// This block exposes all public engine functions on window.app = { ... }.
// The UI layer calls them as: app.fetchNWSWeather(lat, lon)
//
// Guard: Only runs in browser environments (typeof window !== 'undefined').
// In Node.js or Deno, the `export` statements above are the module interface.
//
// ═══════════════════════════════════════════════════════════════════════════════

if (typeof window !== 'undefined') {
    window.app = {
        // ── Section 1-3: Core Physics ──
        calculateVPD,
        getVPDStatus,

        // ── Section 4: Crop Profiles (thermal envelopes) ──
        CROP_PROFILES,
        CROP_TYPES,

        // ── Section 5-6: Crop & Growth ──
        calculateCropNeeds,
        getGrowthStage,

        // ── Section 7-8: Recommendation Engine ──
        getHouseRecommendation,
        processFarmData,

        // ── Section 9-13: Firebase SaaS ──
        // NOTE: firebaseConfig intentionally NOT exported here.
        // It is only used internally by initFirebase(). Exposing it on
        // window.app would make targeted API abuse easier for anyone with devtools.
        initFirebase,
        state,
        loginUser,
        logoutUser,
        setupAuthObserver,
        syncFarmToCloud,
        exportFarmDataToCSV,

        // ── Section 14-15: Data Dictionaries ──
        CLIMATE_PROFILES,
        CLIMATE_PROFILE_KEYS,
        PHOTOSYNTHETIC_CROP_TYPES,
        CROP_TYPE_KEYS,

        // ── Section 16: NWS Weather API ──
        fetchNWSWeather,

        // ── Section 17: DLI Estimation ──
        calculateEstimatedDLI,

        // ── Section 18: Leaf Surface Temperature & True VPD ──
        calculateLST,
        calculateTrueVPD,

        // ── Section 19: Sensor Integration ──
        getLiveSensorData,

        // ── Section 20: Intelligent Failsafe Engine ──
        getIntelligentHouseRecommendation
    };

    devLog(
        '%c 🌿 Greenhouse OS Engine loaded → window.app (' +
        `${Object.keys(window.app).length} exports) `,
        'background:#166534;color:#bbf7d0;font-size:12px;font-weight:bold;' +
        'padding:4px 10px;border-radius:4px;'
    );
}
