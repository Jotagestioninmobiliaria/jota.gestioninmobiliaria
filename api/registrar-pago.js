export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) return res.status(500).json({ error: 'Variables de entorno no configuradas' });

  try {
    const { alquiler_id, periodo, monto_cobrado, honorarios, fecha_pago, estado,
            comprobante_base64, comprobante_nombre,
            comprobante_hon_base64, comprobante_hon_nombre } = req.body;

    if (!alquiler_id || !periodo) return res.status(400).json({ error: 'Faltan campos obligatorios' });

    async function subirArchivo(base64, nombre, prefijo) {
      if (!base64 || !nombre) return null;
      const buffer = Buffer.from(base64, 'base64');
      const fileName = `${alquiler_id}/${periodo}_${prefijo}_${Date.now()}_${nombre}`;
      const r = await fetch(`${SUPABASE_URL}/storage/v1/object/comprobantes/${fileName}`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`, 'Content-Type': 'application/octet-stream', 'x-upsert': 'true' },
        body: buffer,
      });
      return r.ok ? `${SUPABASE_URL}/storage/v1/object/public/comprobantes/${fileName}` : null;
    }

    const comprobante_url = await subirArchivo(comprobante_base64, comprobante_nombre, 'prop');
    const comprobante_hon_url = await subirArchivo(comprobante_hon_base64, comprobante_hon_nombre, 'hon');

    // Verificar si ya existe
    const checkRes = await fetch(`${SUPABASE_URL}/rest/v1/pagos_mensuales?alquiler_id=eq.${alquiler_id}&periodo=eq.${periodo}&select=id`, {
      headers: { 'apikey': SUPABASE_SERVICE_KEY, 'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}` }
    });
    const existing = await checkRes.json();

    const payload = {
      alquiler_id,
      periodo,
      monto_cobrado: monto_cobrado || null,
      honorarios: honorarios || null,
      fecha_pago: fecha_pago || null,
      estado: estado || 'pago-pendiente',
      ...(comprobante_url && { comprobante_url }),
      ...(comprobante_hon_url && { comprobante_hon_url }),
    };

    const method = (existing && existing.length > 0) ? 'PATCH' : 'POST';
    const url = method === 'PATCH'
      ? `${SUPABASE_URL}/rest/v1/pagos_mensuales?alquiler_id=eq.${alquiler_id}&periodo=eq.${periodo}`
      : `${SUPABASE_URL}/rest/v1/pagos_mensuales`;

    const dbRes = await fetch(url, {
      method,
      headers: { 'apikey': SUPABASE_SERVICE_KEY, 'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`, 'Content-Type': 'application/json', 'Prefer': 'return=representation' },
      body: JSON.stringify(payload),
    });

    if (!dbRes.ok) {
      const err = await dbRes.text();
      return res.status(500).json({ error: 'Error al guardar', detalle: err });
    }

    return res.status(200).json({ ok: true, comprobante_url, comprobante_hon_url });

  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
}
