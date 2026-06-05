export default async function handler(req, res) {
  // Solo POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido' });
  }

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    return res.status(500).json({ error: 'Variables de entorno no configuradas' });
  }

  try {
    const { alquiler_id, periodo, monto_cobrado, fecha_pago, estado, comprobante_base64, comprobante_nombre } = req.body;

    if (!alquiler_id || !periodo) {
      return res.status(400).json({ error: 'Faltan campos obligatorios' });
    }

    let comprobante_url = null;

    // Subir comprobante si viene
    if (comprobante_base64 && comprobante_nombre) {
      const buffer = Buffer.from(comprobante_base64, 'base64');
      const fileName = `${alquiler_id}/${periodo}_${Date.now()}_${comprobante_nombre}`;

      const uploadRes = await fetch(
        `${SUPABASE_URL}/storage/v1/object/comprobantes/${fileName}`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
            'Content-Type': 'application/octet-stream',
            'x-upsert': 'true',
          },
          body: buffer,
        }
      );

      if (uploadRes.ok) {
        comprobante_url = `${SUPABASE_URL}/storage/v1/object/public/comprobantes/${fileName}`;
      }
    }

    // Verificar si ya existe registro para ese alquiler/periodo
    const checkRes = await fetch(
      `${SUPABASE_URL}/rest/v1/pagos_mensuales?alquiler_id=eq.${alquiler_id}&periodo=eq.${periodo}&select=id`,
      {
        headers: {
          'apikey': SUPABASE_SERVICE_KEY,
          'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
        }
      }
    );
    const existing = await checkRes.json();

    const payload = {
      alquiler_id,
      periodo,
      monto_cobrado: monto_cobrado || null,
      fecha_pago: fecha_pago || null,
      estado: estado || 'pago-pendiente',
      ...(comprobante_url && { comprobante_url }),
    };

    let dbRes;
    if (existing && existing.length > 0) {
      // UPDATE
      dbRes = await fetch(
        `${SUPABASE_URL}/rest/v1/pagos_mensuales?alquiler_id=eq.${alquiler_id}&periodo=eq.${periodo}`,
        {
          method: 'PATCH',
          headers: {
            'apikey': SUPABASE_SERVICE_KEY,
            'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
            'Content-Type': 'application/json',
            'Prefer': 'return=representation',
          },
          body: JSON.stringify(payload),
        }
      );
    } else {
      // INSERT
      dbRes = await fetch(
        `${SUPABASE_URL}/rest/v1/pagos_mensuales`,
        {
          method: 'POST',
          headers: {
            'apikey': SUPABASE_SERVICE_KEY,
            'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
            'Content-Type': 'application/json',
            'Prefer': 'return=representation',
          },
          body: JSON.stringify(payload),
        }
      );
    }

    if (!dbRes.ok) {
      const err = await dbRes.text();
      return res.status(500).json({ error: 'Error al guardar en base de datos', detalle: err });
    }

    return res.status(200).json({ ok: true, comprobante_url });

  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
