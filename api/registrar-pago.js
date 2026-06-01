const { createClient } = require('@supabase/supabase-js');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido' });
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
      alquiler_id,
      periodo,
      estado: 'pago-pendiente',
      monto_cobrado,
      fecha_pago,
      comprobante_url: comprobante_url || null,
      ...(comprobante_url2 ? { comprobante_url2 } : {})
    };

    let error;

    if (pago_existente_id) {
      ({ error } = await supabase
        .from('pagos_mensuales')
        .update(registro)
        .eq('id', pago_ex
