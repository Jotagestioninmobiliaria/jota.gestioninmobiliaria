// Devuelve la serie oficial del ICL (Índice para Contratos de Locación) del BCRA.
// GET /api/icl?desde=AAAA-MM-DD&hasta=AAAA-MM-DD  →  { ok, idVariable, valores: [{fecha, valor}] }
// Se consulta desde el servidor porque el navegador no puede llamar directo a la API del BCRA.

const BASE = 'https://api.bcra.gob.ar/estadisticas';
let cacheId = null;

async function getJSON(url) {
  const r = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!r.ok) throw new Error(`BCRA respondió ${r.status} en ${url}`);
  return r.json();
}

// Busca en el catálogo la variable del ICL (no dependemos de un número fijo).
async function idICL() {
  if (cacheId) return cacheId;
  try {
    const data = await getJSON(`${BASE}/v4.0/monetarias?limit=1000`);
    const v = (data.results || []).find(x => /contratos de locaci/i.test(x.descripcion || '') || /\bICL\b/.test(x.descripcion || ''));
    if (v) cacheId = v.idVariable;
  } catch (e) { /* si el catálogo falla usamos el id conocido */ }
  return cacheId || 40;
}

// La v4.0 devuelve results:[{idVariable, detalle:[{fecha,valor}]}]; la v3.0 results:[{fecha,valor}].
function aplanar(data) {
  const out = [];
  for (const r of data.results || []) {
    if (Array.isArray(r.detalle)) r.detalle.forEach(d => out.push(d));
    else if (r.fecha) out.push(r);
  }
  return out.map(d => ({ fecha: String(d.fecha).slice(0, 10), valor: Number(d.valor) }))
            .filter(d => d.fecha && !isNaN(d.valor));
}

export default async function handler(req, res) {
  const { desde, hasta } = req.query || {};
  const fecha = /^\d{4}-\d{2}-\d{2}$/;
  if (!fecha.test(desde || '') || !fecha.test(hasta || '')) {
    return res.status(400).json({ ok: false, error: 'Parámetros desde/hasta con formato AAAA-MM-DD' });
  }
  try {
    const id = await idICL();
    const valores = [];
    let offset = 0;
    // La API pagina de a 1000 registros
    for (let i = 0; i < 10; i++) {
      let data;
      try {
        data = await getJSON(`${BASE}/v4.0/monetarias/${id}?desde=${desde}&hasta=${hasta}&limit=1000&offset=${offset}`);
      } catch (e) {
        if (i > 0) throw e;
        data = await getJSON(`${BASE}/v3.0/monetarias/${id}?desde=${desde}&hasta=${hasta}`);
      }
      const page = aplanar(data);
      valores.push(...page);
      if (page.length < 1000) break;
      offset += 1000;
    }
    valores.sort((a, b) => a.fecha.localeCompare(b.fecha));
    res.setHeader('Cache-Control', 's-maxage=3600');
    return res.status(200).json({ ok: true, idVariable: id, valores });
  } catch (e) {
    return res.status(502).json({ ok: false, error: e.message });
  }
}
