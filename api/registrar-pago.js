import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido' });
  }

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
  );

  const { alquiler_id, periodo, monto_cobrado, fecha_pago, comprobante_url, pago_existente_id } = req.body;

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
      comprobante_url: comprobante_url || null
    };

    let error;

    if (pago_existente_id) {
      ({ error } = await supabase
        .from('pagos_mensuales')
        .update(registro)
        .eq('id', pago_existente_id));
    } else {
      ({ error } = await supabase
        .from('pagos_mensuales')
        .insert(registro));
    }

    if (error) throw error;

    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error('Error registrar-pago:', e);
    return res.status(500).json({ error: e.message || 'Error interno' });
  }
}
