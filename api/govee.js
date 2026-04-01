// Govee API Proxy — Vercel Serverless Function
// 
// Proxies requests to the Govee Developer API to avoid CORS restrictions.
// The user's Govee API key is passed from the frontend (stored in Firestore,
// never committed to the repo).
//
// Endpoints:
//   GET /api/govee?action=devices        → Lists all Govee devices
//   GET /api/govee?action=state&device=MAC&model=SKU → Gets device state
//

const GOVEE_BASE = 'https://developer-api.govee.com/v1';

export default async function handler(req, res) {
    // CORS headers — locked to known deployment origins (not wildcard)
    const ALLOWED_ORIGINS = [
        'https://practicalfarmtools.com',
        'https://www.practicalfarmtools.com',
        'https://greenhouse-os.vercel.app',  // Vercel preview/testing
        'http://localhost:3000'               // Local dev
    ];
    const origin = req.headers.origin || '';
    const ALLOWED_ORIGIN = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
    res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-govee-key');
    res.setHeader('Vary', 'Origin');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    // Header only — never accept keys as URL query params (they leak into server logs)
    const apiKey = req.headers['x-govee-key'];
    if (!apiKey) {
        return res.status(400).json({ 
            error: 'Missing Govee API key. Pass via x-govee-key header.' 
        });
    }

    const { action, device, model } = req.query;

    try {
        let url;
        if (action === 'devices') {
            url = `${GOVEE_BASE}/devices`;
        } else if (action === 'state') {
            if (!device || !model) {
                return res.status(400).json({ 
                    error: 'action=state requires device (MAC) and model (SKU) params.' 
                });
            }
            url = `${GOVEE_BASE}/devices/state?device=${encodeURIComponent(device)}&model=${encodeURIComponent(model)}`;
        } else {
            return res.status(400).json({ 
                error: 'Invalid action. Use action=devices or action=state.' 
            });
        }

        const goveeRes = await fetch(url, {
            headers: { 'Govee-API-Key': apiKey }
        });

        const data = await goveeRes.json();

        // Forward Govee's rate limit headers if present
        const rateHeaders = ['x-ratelimit-remaining', 'x-ratelimit-limit'];
        rateHeaders.forEach(h => {
            const val = goveeRes.headers.get(h);
            if (val) res.setHeader(h, val);
        });

        return res.status(goveeRes.status).json(data);

    } catch (err) {
        console.error('[govee-proxy] Error:', err.message);
        return res.status(502).json({ 
            error: 'Failed to reach Govee API. Please try again.'
        });
    }
}
