# 🌿 GrowPulse

Sensor-less thermodynamic and biology engine for greenhouse management.  
Part of the **Practical Farm Tools** suite — [practicalfarmtools.com](https://practicalfarmtools.com)

**Location Baseline:** USDA Zone 5b — coastal Maine (44.08°N)

## Features

- **Crop-Specific Temperature Deadbands** — Day/night differential (DIF) modeling with multi-crop overlap detection
- **Growth Stage Transpiration** — Canopy-driven humidity modeling (seedling → vegetative → mature)
- **Vapor Pressure Deficit (VPD)** — Real-time estimation via the Tetens equation
- **Wind & Ventilation Dynamics** — Aerodynamic Bernoulli/cross-wind analysis for greenhouse orientation
- **Live Weather Integration** — NWS hourly forecast via GPS location

## Crop Profiles

| Crop | ☀️ Day Range | 🌙 Night Range | Botrytis RH |
|------|------------|--------------|-------------|
| Solanaceous (Tomatoes / Peppers) | 70–85°F | 60–68°F | 85% |
| Cold-Hardy Greens (Spinach / Kale) | 35–70°F | 28–55°F | 80% |
| Cucurbits (Cucumbers / Melons) | 75–90°F | 60–70°F | 90% |
| Root Vegetables (Carrots / Beets) | 40–75°F | 35–60°F | 83% |

## Files

| File | Purpose |
|------|---------|
| `growpulse-engine.js` | Core physics & biology engine (pure functions, no DOM) |
| `growpulse.html` | Multi-structure management dashboard (PWA shell) |
| `growpulse-walkthrough.html` | User guide & walkthrough |
| `index.html` | Entry point — redirects to growpulse.html |
| `api/govee.js` | Vercel serverless proxy for Govee sensor API |

## Usage

Deploy to Vercel (or any static host). Point your domain at the project root.  
`index.html` handles the redirect to `growpulse.html` automatically.

For live weather data, an internet connection is required (NWS API — free, no key needed).

## References

- Elad (1997) — Botrytis cinerea sporulation thresholds
- FAO 56, Allen et al. (1998) — Crop coefficient curves
- Stanghellini (1987) — Greenhouse transpiration modeling
- Coleman (2009) — The Winter Harvest Handbook
- Bolton et al. (2006) — Sclerotinia sclerotiorum biology

## License

Private — Practical Farm Tools
