const { createClient } = require('@supabase/supabase-js');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Metodo no permitido' });
  }

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
  );

  const { alquiler_id, periodo, monto_cobrado, fecha_pago, comprobante_url, comprobante_url2, pago_existente_id } = req.body;

  if (!alquiler_id || !periodo || !monto_cobrado || !fecha_pago) {
    return res.status(400).json({ error: 'Faltan campos requeridos' });
  }

  try {
    const registro = {
      alquiler_id: alquiler_id,
      periodo: periodo,
      estado: 'pago-pendiente',
      monto_cobrado: monto_cobrado,
      fecha_pago: fecha_pago,
      comprobante_url: comprobante_url || null,
      comprobante_url2: comprobante_url2 || null
    };

    let result;

    if (pago_existente_id) {
      result = await supabase
        .from('pagos_mensuales')
        .update(registro)
        .eq('id', pago_existente_id);
    } else {
      result = await supabase
        .from('pagos_mensuales')
        .insert(registro);
    }

    if (result.error) throw result.error;

    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error('Error registrar-pago:', e);
    return res.status(500).json({ error: e.message || 'Error interno' });
  }
};
