// =============================================
// ALQUILERES · MES ACTUAL (Parte 1)
// Pestañas DB/GB y Propietarios · Aumentos ICL · WhatsApp · Avisado/Pagado
// Usa las variables globales de index.html: db, showToast, currentUser
// =============================================

const AX_MESES = ['','Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
const AX_ETAPAS = {
  sin_avisar: { label: 'Sin avisar', bg: '',        pill: '#F1EFE8', color: '#5F5E5A' },
  avisado:    { label: 'Avisado',    bg: '#FFF7D1', pill: '#FBE7A1', color: '#7A5B00' },
  parcial:    { label: 'Pago parcial', bg: '#FFEFE0', pill: '#FAD3AE', color: '#8A4A00' },
  pagado:     { label: 'Pagado',     bg: '#EEF7E6', pill: '#D6EDC4', color: '#3B6D11' },
  rendido:    { label: 'Rendido',    bg: '#D9EFC9', pill: '#3B6D11', color: '#FFFFFF' },
};
const AX_MAO_PAGO = `Número de CVU: 0000003100003402497322
Alias de CVU: PROPIEDADESMAO
Titular de la cuenta: Juliana Rubio`;

let axAlq = [], axPagos = [], axAjustes = [], axProps = [];
let axPeriodo = '', axTab = 'prop', axOpen = null, axBusqueda = '', axFiltroEtapa = '', axSoloAumento = false;
let axPend = [], axDeudas = [], axCobros = [], axDeudaOK = true;
let axSchemaOK = true, axICL = null, axICLError = null, axICLCargando = false;
const axPartido = {}, axMsgEditado = {};

// La vista ocupa el ancho de la pantalla (sin esto, en pantallas de 1366 px la lista se cortaba a la derecha)
(function(){
  const st = document.createElement('style');
  st.textContent = '.main.ax-ancho{width:calc(100% - 220px);box-sizing:border-box;min-width:0}.ax-scroll{overflow-x:auto}';
  document.head.appendChild(st);
})();
function axAncho(){ document.getElementById('main')?.classList.add('ax-ancho'); }

// ---------- utilidades ----------
function axH(s){ return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function axNorm(s){ return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g,'').toUpperCase().replace(/\s+/g,' ').trim(); }
function axCompact(s){ return axNorm(s).replace(/[^A-Z0-9]/g,''); }
function axPesos(n){ return '$' + Math.round(Number(n) || 0).toLocaleString('es-AR'); }
function axUSD(n){ return 'USD ' + Math.round(Number(n) || 0).toLocaleString('es-AR'); }
function axMonto(n, usd){ return usd ? axUSD(n) : axPesos(n); }
function axHoyPeriodo(){ const d = new Date(); return `${String(d.getMonth()+1).padStart(2,'0')}-${d.getFullYear()}`; }
function axPeriodoNum(p){ const [m,y] = p.split('-').map(Number); return y*12 + m; }
function axFmtPeriodo(p){ const [m,y] = p.split('-'); return `${AX_MESES[parseInt(m)]} ${y}`; }
function axISO(d){ return d ? `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}` : null; }
function axFmtFecha(d){ return d ? d.toLocaleDateString('es-AR', {day:'2-digit', month:'2-digit', year:'numeric'}) : '—'; }
function axDiasMes(y, m){ return new Date(y, m, 0).getDate(); }

// Acepta 'AAAA-MM-DD', 'DD/MM/AAAA' y 'DD/MM/AA'
function axParseFecha(s){
  if(!s) return null;
  if(s instanceof Date) return isNaN(s) ? null : s;
  const t = String(s).trim();
  let m = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if(m) return new Date(+m[1], +m[2]-1, +m[3]);
  m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if(m){ const y = m[3].length === 2 ? 2000 + +m[3] : +m[3]; return new Date(y, +m[2]-1, +m[1]); }
  return null;
}
function axSumarMeses(d, n){
  const y = d.getFullYear(), m = d.getMonth() + n;
  const dia = Math.min(d.getDate(), new Date(y, m + 1, 0).getDate());
  return new Date(y, m, dia);
}

// ---------- reglas de negocio ----------
function axTipoContrato(a){ return axNorm(a.tipo_contrato).replace('CUATRIMENTRAL','CUATRIMESTRAL').replace('SEMESTAL','SEMESTRAL'); }
function axPeriodicidad(a){
  if(a.periodicidad_meses) return Number(a.periodicidad_meses);
  return { TRIMESTRAL: 3, CUATRIMESTRAL: 4, SEMESTRAL: 6 }[axTipoContrato(a)] || null;
}
function axEsUSD(a){ return a.moneda === 'USD' || (!(Number(a.alq_actual) > 0) && Number(a.alq_actual_usd) > 0); }
function axImporte(a){ return Number(axEsUSD(a) ? a.alq_actual_usd : a.alq_actual) || 0; }
// En la base algunas unidades combinadas tienen parent_id = su propio id: no son "hijas"
function axEsHija(a){ return !!a.parent_id && a.parent_id !== a.id; }
function axActiva(a){ return a.activo !== false && !axEsHija(a) && !!(a.inquilino || '').trim() && axImporte(a) > 0; }
// Pestañas: DB (Diego Baroffi), DB+GB y el resto de los propietarios
function axTabDe(a){ const p = axNorm(a.propietario).replace(/\s/g,''); return p === 'DB' ? 'db' : p === 'DB+GB' ? 'dbgb' : 'prop'; }
function axSinICL(a){ const t = axTipoContrato(a); return t === 'FIJO' || t === 'SIN CONTRATO' || axEsUSD(a); }
// Índice de ajuste (columna "ajuste"): ICL por defecto; IPC se avisa pero no se calcula
function axIndice(a){ return axNorm(a.ajuste) === 'IPC' ? 'IPC' : 'ICL'; }
function axEdificio(a){ return a.edificio || a.direccion || ''; }
function axNombreUnidad(a){
  const ed = axEdificio(a), un = a.unidad || '';
  // Si la unidad ya trae la calle (ej. "ITUZAINGO 652 AUDITORIO"), no se repite el edificio
  const calle = axCompact(ed.replace(/\d+/g, ''));
  if(!ed || axCompact(un).includes(axCompact(ed)) || (calle && axCompact(un).replace(/ITUZANGO/g, 'ITUZAINGO').includes(calle))) return un || ed;
  return `${ed} · ${un}`;
}

// ¿Le toca aumento en el período? Calcula por fecha de inicio + periodicidad
// y lo compara con la columna MES AUMENTO.
function axAumento(a, periodo){
  if(axSinICL(a)) return null;
  const [m, y] = periodo.split('-').map(Number);
  const mesNombre = axNorm(AX_MESES[m]);
  const porTexto = axNorm(a.mes_aumento).split(/[-,\s]+/).includes(mesNombre);
  const per = axPeriodicidad(a), ini = axParseFecha(a.inicio_contrato);
  if(!per || !ini) return porTexto ? { sinFechas: true, porTexto, porCalendario: null } : null;
  const diff = (y - ini.getFullYear()) * 12 + (m - 1 - ini.getMonth());
  const porCalendario = diff > 0 && diff % per === 0;
  if(!porCalendario && !porTexto) return null;
  // Con fecha de inicio y periodicidad manda el calendario; si solo lo dice MES AUMENTO, se avisa pero no se calcula.
  if(!porCalendario) return { porCalendario, porTexto, diferencia: true, soloTexto: true, per };
  const fechaAjuste = axSumarMeses(ini, diff);
  // ICL inicial = el del último aumento aplicado (o el inicio del contrato si nunca se aumentó).
  // Normalmente es el período anterior; si hubo aumentos sin aplicar, el cálculo los recupera.
  const ult = axParseFecha(a.fecha_ultimo_ajuste);
  const yaIncluido = !!(ult && ult >= fechaAjuste);
  let fechaBase = axSumarMeses(ini, diff - per), atrasado = false;
  const nuncaAumentado = !ult && Number(a.alq_inicial) > 0 && Number(a.alq_inicial) === Number(a.alq_actual);
  if(ult && ult < fechaBase){ fechaBase = ult; atrasado = true; }
  else if(nuncaAumentado && ini < fechaBase){ fechaBase = ini; atrasado = true; }
  return { porCalendario, porTexto, diferencia: porCalendario !== porTexto, fechaAjuste, fechaBase, per, yaIncluido, atrasado };
}

// Regla de cobro: si el aumento rige del 1 al 10 se cobra ese mes (proporcional);
// si rige después del 10, ese mes se cobra el importe anterior y el mes siguiente
// el importe nuevo + la diferencia de los días del mes anterior.
const AX_DIA_LIMITE = 10;
function axPeriodoAnterior(p){ const [m, y] = p.split('-').map(Number); return m === 1 ? `12-${y - 1}` : `${String(m - 1).padStart(2,'0')}-${y}`; }
function axAumentoCobro(a, periodo){
  const prev = axAumento(a, axPeriodoAnterior(periodo));
  if(prev && prev.fechaAjuste && prev.fechaAjuste.getDate() > AX_DIA_LIMITE) return { ...prev, diferenciaMesAnterior: true };
  const au = axAumento(a, periodo);
  if(au && au.fechaAjuste && au.fechaAjuste.getDate() > AX_DIA_LIMITE) return { ...au, cobroSiguiente: true };
  return au;
}

function axAjusteDe(id){ return axAjustes.find(x => x.alquiler_id === id && x.periodo === axPeriodo); }
function axPagoDe(id){ return axPagos.find(x => x.alquiler_id === id); }
function axPropDe(a){
  if(a.propietario_id) { const p = axProps.find(x => x.id === a.propietario_id); if(p) return p; }
  return axProps.find(x => axNorm(x.nombre) === axNorm(a.propietario)) || null;
}
function axEtapa(p){
  if(!p) return 'sin_avisar';
  if(p.etapa) return p.etapa;
  if(p.estado === 'pagado' || p.estado === 'parcial') return 'pagado';
  if(p.fecha_envio) return 'avisado';
  return 'sin_avisar';
}

// ---------- deudas ----------
// Desde noviembre 2026 la app arma sola la deuda: todo mes anterior que no quedó pagado.
// Lo de antes (o expensas, intereses, etc.) se carga a mano en la tabla "deudas".
// Interés por mora: simple, % por mes de atraso (columna interes_mensual de la unidad),
// solo sobre deudas de alquiler. Lo ya devengado se guarda en cada pago para no cobrarlo dos veces.
const AX_DEUDA_DESDE = '11-2026';
const AX_CONCEPTOS = ['Alquiler', 'Expensas', 'Cochera', 'Intereses', 'Otro'];
function axPagoSaldo(p){ return Math.max(0, Math.round((Number(p.monto_esperado) || 0) - (Number(p.monto_cobrado) || 0))); }
function axMesesAtraso(desde){ return Math.max(0, axPeriodoNum(axPeriodo) - axPeriodoNum(desde)); }
// Interés pendiente de un ítem (devengado hasta el mes que se mira − lo ya pagado)
function axInteresItem(a, ref, periodo, concepto, saldo){
  const tasa = Number(a.interes_mensual) || 0;
  if(!(tasa > 0) || concepto !== 'Alquiler') return { tasa: 0, meses: 0, devengado: Number(ref.interes_devengado) || 0, interes: 0 };
  const meses = axMesesAtraso(periodo);
  const devengado = (Number(ref.interes_devengado) || 0) + saldo * tasa * axMesesAtraso(ref.interes_calc_periodo || periodo);
  return { tasa, meses, devengado: Math.round(devengado), interes: Math.max(0, Math.round(devengado - (Number(ref.interes_pagado) || 0))) };
}
// Deuda de meses anteriores de una unidad, de la más vieja a la más nueva
function axDeudaItems(a){
  if(!axDeudaOK) return [];
  const hoy = axPeriodoNum(axPeriodo), desde = axPeriodoNum(AX_DEUDA_DESDE), usd = axEsUSD(a);
  const items = [];
  axPend.filter(p => p.alquiler_id === a.id && axPeriodoNum(p.periodo) >= desde && axPeriodoNum(p.periodo) < hoy && axPagoSaldo(p) > 0)
    .forEach(p => items.push({ tipo: 'pago', ref: p, periodo: p.periodo, concepto: 'Alquiler', saldo: axPagoSaldo(p) }));
  axDeudas.filter(d => d.alquiler_id === a.id && axPeriodoNum(d.periodo) < hoy && Math.round(Number(d.monto) - (Number(d.pagado) || 0)) > 0)
    .forEach(d => items.push({ tipo: 'deuda', ref: d, periodo: d.periodo, concepto: d.concepto || 'Alquiler', detalle: d.detalle, saldo: Math.round(Number(d.monto) - (Number(d.pagado) || 0)) }));
  items.forEach(it => {
    Object.assign(it, axInteresItem(a, it.ref, it.periodo, it.concepto, it.saldo)); it.usd = usd; it.total = it.saldo + it.interes;
    // Meses de interés que se cobran ahora (si parte ya venía incluida o pagada, son menos que los de atraso)
    if(it.interes && it.saldo) it.meses = Math.max(1, Math.round(it.interes / (it.saldo * it.tasa)));
  });
  return items.sort((x, y) => axPeriodoNum(x.periodo) - axPeriodoNum(y.periodo) || AX_CONCEPTOS.indexOf(x.concepto) - AX_CONCEPTOS.indexOf(y.concepto));
}
function axDeudaTotal(a){ return axDeudaItems(a).reduce((s, it) => s + it.total, 0); }
// Lo que falta pagar del mes (si ya pagó una parte, se descuenta)
function axSaldoMes(a){
  const p = axPagoDe(a.id), e = axEtapa(p), total = axTotalMes(a);
  if(!axActiva(a) || e === 'pagado' || e === 'rendido') return 0;
  return Math.max(0, total - (e === 'parcial' ? Number(p.monto_cobrado) || 0 : 0));
}
function axAPagar(a){ return axSaldoMes(a) + axDeudaTotal(a); }
// Honorarios que corresponden a la deuda de alquiler (misma proporción que el mes)
function axHonorDeuda(a){
  if(axEsUSD(a)) return 0;
  const c = axCalculoMes(a), ratio = c.total ? axHonorarios(a, c.base) / c.total : 0;
  return Math.round(axDeudaItems(a).filter(it => it.concepto === 'Alquiler').reduce((s, it) => s + it.saldo, 0) * ratio);
}
function axTextoItem(it){
  const qué = it.concepto === 'Alquiler' ? '' : it.concepto + ' ';
  let t = `Pendiente ${qué}${axFmtPeriodo(it.periodo)}${it.detalle ? ` (${it.detalle})` : ''} ${axMonto(it.saldo, it.usd)}.-`;
  if(it.interes) t += `\n  Intereses por mora (${(it.tasa * 100).toLocaleString('es-AR')}% x ${it.meses} mes${it.meses !== 1 ? 'es' : ''}) ${axMonto(it.interes, it.usd)}.-`;
  return t;
}

// Monto del mes: si hay aumento confirmado y rige desde un día distinto del 1,
// se cobra el mes partido (días con el importe anterior + días con el nuevo).
// Monto del mes con IVA (si la unidad lo factura): el aumento se calcula sobre el neto
function axCalculoMes(a){
  const c = axCalculoMesNeto(a);
  const pct = Number(a.iva_pct) || 0;
  if(!(pct > 0)) return { ...c, base: c.total, iva: 0 };
  const iva = Math.round(c.total * pct);
  return { ...c, base: c.total, iva, ivaPct: pct, total: c.total + iva };
}
function axCalculoMesNeto(a){
  const aj = axAjusteDe(a.id), usd = axEsUSD(a);
  const actual = axImporte(a);
  if(!aj) return { total: actual, usd, lineas: null, aj: null };
  const fa = axParseFecha(aj.fecha_ajuste);
  const [m, y] = axPeriodo.split('-').map(Number);
  const dm = axDiasMes(y, m);
  const ant = Number(aj.importe_anterior), nue = Number(aj.importe_nuevo);
  // Aumento del mes anterior (después del 10): importe nuevo + diferencia de esos días
  if(fa && (fa.getMonth() + 1 !== m || fa.getFullYear() !== y)){
    const dmA = axDiasMes(fa.getFullYear(), fa.getMonth() + 1);
    const dias = dmA - fa.getDate() + 1;
    const diario = (nue - ant) / dmA;
    const monto = Math.round(diario * dias);
    return { total: nue + monto, usd, lineas: null, aj, diasAnt: 0, diferencia: { dias, diario, monto, desde: fa } };
  }
  const diasAnt = fa ? fa.getDate() - 1 : 0;
  const partido = diasAnt > 0 && axPartido[a.id] !== false;
  if(!partido) return { total: Number(aj.importe_nuevo), usd, lineas: null, aj, diasAnt };
  const diasNue = dm - diasAnt;
  const pAnt = Number(aj.importe_anterior) / dm * diasAnt;
  const pNue = Number(aj.importe_nuevo) / dm * diasNue;
  return {
    total: Math.round(pAnt + pNue), usd, aj, diasAnt,
    lineas: [
      { dias: diasAnt, diario: Number(aj.importe_anterior) / dm, subtotal: pAnt },
      { dias: diasNue, diario: Number(aj.importe_nuevo) / dm, subtotal: pNue },
    ],
  };
}
// La comisión fija está en comision_db (unidades DB/GB) o en comision_adm (el resto)
function axCampoComision(a){ return a.comision_db !== null && a.comision_db !== undefined && !(Number(a.comision_adm) > 0) ? 'comision_db' : 'comision_adm'; }
function axHonorarios(a, total){
  const pct = Number(a.comision_pct);
  if(pct > 0 && pct < 1) return Math.round(total * pct);
  return Math.round(Number(a[axCampoComision(a)]) || 0);
}

function axWAPhone(t){
  if(!t) return '';
  let n = String(t).trim().replace(/\.0+$/, '').replace(/\D/g,''); // Excel a veces guarda "3415551234.0"
  if(n.startsWith('549') && n.length === 13) return n;
  if(n.startsWith('54')) n = n.substring(2);
  if(n.startsWith('0')) n = n.substring(1);
  if(n.startsWith('9') && n.length > 10) n = n.substring(1);
  if(n.length !== 10) return '';
  return '549' + n;
}

// Mismo inquilino = mismo teléfono o mismo nombre
function axMismoInquilino(a, x){
  const ta = axWAPhone(a.tel_inquilino), tx = axWAPhone(x.tel_inquilino);
  return (ta && ta === tx) || (axCompact(a.inquilino) && axCompact(a.inquilino) === axCompact(x.inquilino));
}
function axGrupoInquilino(a){
  return [a, ...axAlq.filter(x => x.id !== a.id && axActiva(x) && axMismoInquilino(a, x))];
}
function axTelGrupo(a){ for(const x of axGrupoInquilino(a)){ const t = axWAPhone(x.tel_inquilino); if(t) return t; } return ''; }

function axLineasUnidad(a, conNombre){
  const c = axCalculoMes(a), mes = axFmtPeriodo(axPeriodo), usd = c.usd;
  let titulo = conNombre ? axNombreUnidad(a) : `Alquiler ${mes}`;
  let txt = '';
  if(c.aj && conNombre) titulo += ` (actualización por ICL: de ${axMonto(c.aj.importe_anterior, usd)} a ${axMonto(c.aj.importe_nuevo, usd)})`;
  else if(c.aj) txt += `Este mes se aplica la actualización por ICL: el alquiler pasa de ${axMonto(c.aj.importe_anterior, usd)} a ${axMonto(c.aj.importe_nuevo, usd)}.\n\n`;
  if(c.diferencia){
    const d = c.diferencia;
    txt += `${titulo}${conNombre ? ':' : ''} ${axMonto(c.aj.importe_nuevo, usd)}.-\n`;
    txt += `Diferencia por el aumento desde el ${axFmtFecha(d.desde)} (${d.dias} días x ${axMonto(d.diario, usd)}): ${axMonto(d.monto, usd)}.-\n`;
    txt += `Total ${axMonto(c.base, usd)}.-\n`;
  } else if(c.lineas){
    txt += `${titulo}:\n`;
    c.lineas.forEach(l => { txt += `  ${l.dias} días x ${axMonto(l.diario, usd)} = ${axMonto(l.subtotal, usd)}\n`; });
    txt += `  Total ${axMonto(c.base, usd)}.-\n`;
  } else {
    txt += `${titulo}${conNombre ? ':' : ''} ${axMonto(c.base, usd)}.-\n`;
  }
  if(c.iva) txt += `IVA ${(c.ivaPct * 100).toLocaleString('es-AR')}%: ${axMonto(c.iva, usd)}.-\nTotal con IVA ${axMonto(c.total, usd)}.-\n`;
  const extra = axExtraMes(a);
  if(extra) txt += `Menos expensas extraordinarias: −${axMonto(extra, usd)}.-\nTotal ${axMonto(axTotalMes(a), usd)}.-\n`;
  const bol = axBoletasEnviadas(a);
  if(bol.length) txt += `Te adjunto ${bol.length > 1 ? 'las boletas' : 'la boleta'} de ${axLista(bol)} de ${mes} para que ${bol.length > 1 ? 'las abones' : 'la abones'}.\n`;
  const p = axPagoDe(a.id);
  if(['pagado','rendido'].includes(axEtapa(p))) txt += `Abonado ✓\n`;
  else if(axEtapa(p) === 'parcial' && Number(p.monto_cobrado) > 0) txt += `Pagado a cuenta: ${axMonto(p.monto_cobrado, usd)}.- · Resta ${axMonto(axSaldoMes(a), usd)}.-\n`;
  const deuda = axDeudaItems(a);
  if(deuda.length) txt += `\nSaldo pendiente de meses anteriores${conNombre ? ` (${axNombreUnidad(a)})` : ''}:\n` + deuda.map(axTextoItem).join('\n') + '\n';
  return txt;
}

// Datos de pago de un grupo de unidades del mismo propietario
function axBloquePago(unidades){
  const a = unidades[0], prop = axPropDe(a);
  const usd = axEsUSD(a);
  // Total = lo que falta del mes + la deuda anterior (con intereses)
  const total = unidades.reduce((s, x) => s + axAPagar(x), 0);
  const conDeuda = unidades.some(x => axDeudaItems(x).length || axEtapa(axPagoDe(x.id)) === 'parcial');
  const honor = usd ? 0 : unidades.reduce((s, x) => s + (axSaldoMes(x) > 0 ? axHonorarios(x, axCalculoMes(x).base) : 0) + axHonorDeuda(x), 0);
  const T = conDeuda ? 'TOTAL PENDIENTE AL DÍA DE LA FECHA' : 'TOTAL a abonar';
  const tieneBanco = prop && (prop.cbu || prop.nro_cuenta || prop.alias_mao);
  const banco = () => {
    let t = `Titular: ${prop.titular || prop.nombre}\n`;
    if(prop.banco) t += `Banco: ${prop.banco}\n`;
    if(prop.nro_cuenta) t += `N° de cuenta: ${prop.nro_cuenta}\n`;
    if(prop.cbu) t += `CBU: ${prop.cbu}\n`;
    if(prop.alias_mao && !prop.cbu) t += `Alias: ${prop.alias_mao}\n`;
    return t;
  };
  if(prop && prop.datos_pago_wa) return `\n${T} ${axMonto(total, usd)}.-\n${prop.datos_pago_wa}\n`;
  if(axTabDe(a) === 'prop' && tieneBanco && honor > 0){
    return `Se descuentan honorarios inmobiliarios ${axPesos(honor)}.- (descontados al propietario/a)\n\n`
      + `TOTAL a depositar a ${prop.titular || prop.nombre} ${axPesos(total - honor)}.-\n${banco()}`
      + `\nTOTAL a depositar a MAO Propiedades ${axPesos(honor)}.- (honorarios inmobiliarios)\n${AX_MAO_PAGO}\n`;
  }
  if(tieneBanco) return conDeuda ? `\n${T} ${axMonto(total, usd)}.-\nDepositar a ${prop.titular || prop.nombre}\n${banco()}` : `\nTOTAL a depositar a ${prop.titular || prop.nombre} ${axMonto(total, usd)}.-\n${banco()}`;
  if(axTabDe(a) === 'prop') return `\n${T} ${axMonto(total, usd)}.-\n${AX_MAO_PAGO}\n`;
  return `\n${T} ${axMonto(total, usd)}.-\n[Completar datos de pago de ${a.propietario || 'propietario'}]\n`;
}

// Mensaje para el inquilino con TODAS sus unidades del mes, agrupadas por a quién se paga
function axMensaje(a){
  const grupo = axGrupoInquilino(a), mes = axFmtPeriodo(axPeriodo);
  // Nombre completo: en la planilla a veces está "Apellido Nombre" y otras "Nombre Apellido"
  const nombre = (a.inquilino || '').trim();
  const bloques = {};
  grupo.forEach(x => { const k = axNorm(x.propietario) + '|' + (axEsUSD(x) ? 'USD' : 'ARS'); (bloques[k] = bloques[k] || []).push(x); });
  const lista = Object.values(bloques);
  if(grupo.length === 1){
    return `Hola ${nombre}, buen día! ¿Cómo estás?\nTe paso el detalle de ${mes} (${axNombreUnidad(a)}).\n\n`
      + axLineasUnidad(a, false) + axBloquePago(grupo).replace(/\n$/, '');
  }
  let txt = `Hola ${nombre}, buen día! ¿Cómo estás?\nTe paso el detalle de ${mes}.\n`;
  lista.forEach((us, i) => {
    txt += (i > 0 ? '\n———\n' : '\n') + us.map(x => axLineasUnidad(x, true)).join('') + axBloquePago(us);
  });
  return txt.replace(/\n$/, '');
}

// ---------- carga de datos ----------
async function loadAlquileres(){
  axAncho();
  if(!axPeriodo) axPeriodo = axHoyPeriodo();
  document.getElementById('main').innerHTML = '<div class="loading"><div class="spinner"></div><span>Cargando alquileres...</span></div>';
  const [r1, r2, r3, r4, r5, r6, r7, r8] = await Promise.all([
    db.from('alquileres').select('*').order('id'),
    db.from('pagos_mensuales').select('*').eq('periodo', axPeriodo),
    db.from('ajustes_icl').select('*').eq('periodo', axPeriodo),
    db.from('propietarios').select('*'),
    // meses sin pagar (de cualquier período) para armar la deuda
    db.from('pagos_mensuales').select('*').in('etapa', ['sin_avisar', 'avisado', 'parcial']),
    db.from('deudas').select('*').order('id'),
    db.from('cobros').select('*').order('id', { ascending: false }).limit(500),
    db.from('servicios_mes').select('*').eq('periodo', axPeriodo),
  ]);
  if(r1.error){ document.getElementById('main').innerHTML = `<div class="loading"><span style="color:var(--red)">❌ ${axH(r1.error.message)}</span></div>`; return; }
  axAlq = r1.data || []; axPagos = r2.data || []; axProps = r4.data || [];
  axSchemaOK = !r3.error;
  axAjustes = r3.error ? [] : (r3.data || []);
  axDeudaOK = !r6.error && !r7.error;
  axServOK = !r8.error; axServ = r8.data || [];
  axPend = r5.data || []; axDeudas = r6.data || []; axCobros = r7.data || [];
  if(axSchemaOK) await axGenerarMes();
  renderAlquileres();
  if(axSchemaOK) axCargarICL();
}

// El mes nuevo se arma solo: una fila por unidad activa que todavía no tenga registro.
async function axGenerarMes(){
  if(axPeriodoNum(axPeriodo) < axPeriodoNum(axHoyPeriodo())) return;
  const faltan = axAlq.filter(a => axActiva(a) && !axPagoDe(a.id));
  if(faltan.length === 0) return;
  const filas = faltan.map(a => ({
    alquiler_id: a.id, periodo: axPeriodo, etapa: 'sin_avisar', estado: 'pendiente',
    monto_esperado: axImporte(a), moneda: axEsUSD(a) ? 'USD' : 'ARS',
  }));
  const { data, error } = await db.from('pagos_mensuales').insert(filas).select();
  if(error){ showToast('No se pudo generar el mes: ' + error.message); return; }
  axPagos.push(...(data || []));
}

async function axCargarICL(){
  // Para encadenar desde el inicio del contrato se necesita el ICL desde la fecha de inicio
  const pend = axAlq.filter(a => axActiva(a)).map(a => ({ a, au: axAumentoCobro(a, axPeriodo) }))
    .filter(x => x.au && x.au.fechaAjuste && !x.au.cobroSiguiente && axIndice(x.a) === 'ICL' && axParseFecha(x.a.inicio_contrato));
  if(pend.length === 0 || axICLCargando) return;
  const desde = new Date(Math.min(...pend.map(x => axParseFecha(x.a.inicio_contrato)))); desde.setDate(desde.getDate() - 15);
  const hasta = new Date(Math.max(...pend.map(x => x.au.fechaAjuste)));
  if(axICL && axICL.desde <= axISO(desde) && axICL.hasta >= axISO(hasta)) return;
  axICLCargando = true; axICLError = null;
  try {
    const r = await fetch(`/api/icl?desde=${axISO(desde)}&hasta=${axISO(hasta)}`);
    const j = await r.json();
    if(!j.ok) throw new Error(j.error || 'Sin datos');
    axICL = { desde: axISO(desde), hasta: axISO(hasta), valores: j.valores };
  } catch(e) {
    axICLError = e.message;
  }
  axICLCargando = false;
  if(currentView === 'alquileres2') renderAlquileres();
}

// Valor ICL de una fecha (o del último día publicado anterior)
function axICLEn(fecha){
  if(!axICL || !axICL.valores.length) return null;
  const iso = axISO(fecha);
  let v = null;
  for(const x of axICL.valores){ if(x.fecha <= iso) v = x; else break; }
  return v ? { ...v, exacto: v.fecha === iso } : null;
}

// Método COCIR: cada período = alquiler inicial × ICL(fecha del aumento) ÷ ICL(fecha de inicio),
// redondeado al peso. Equivale a encadenar los aumentos sin redondear en el medio, y no depende
// de que el "alquiler actual" cargado esté al día.
// Devuelve los montos de cada período hasta la fecha indicada (incluida).
function axCadenaICL(a, hasta){
  const ini = axParseFecha(a.inicio_contrato), per = axPeriodicidad(a), base = Number(a.alq_inicial);
  if(!ini || !per || !(base > 0)) return null;
  const icl0 = axICLEn(ini);
  if(!icl0) return null;
  const pasos = [{ fecha: ini, icl: icl0, monto: base }];
  for(let k = 1; ; k++){
    const f = axSumarMeses(ini, k * per);
    if(f > hasta) break;
    const icl = axICLEn(f);
    if(!icl) return null;
    pasos.push({ fecha: f, icl, monto: Math.round(base * icl.valor / icl0.valor) });
  }
  return pasos;
}

function axCalculoICL(a){
  const au = axAumentoCobro(a, axPeriodo);
  if(!au) return null;
  const aj = axAjusteDe(a.id);
  if(aj) return { au, aj, confirmado: true };
  if(axIndice(a) === 'IPC' && au.fechaAjuste) return { au, info: `Ajusta por IPC (no por ICL): el ${axFmtFecha(au.fechaAjuste)} calculá el monto nuevo y cargalo con "✎ Editar datos de la unidad"` };
  if(au.cobroSiguiente && !au.yaIncluido) return { au, info: `Rige el ${axFmtFecha(au.fechaAjuste)} (después del día ${AX_DIA_LIMITE}): este mes se cobra el importe actual; el aumento y la diferencia se calculan el mes que viene` };
  if(au.yaIncluido) return { au, incluido: true };
  if(au.soloTexto) return { au, error: 'MES AUMENTO dice este mes, pero por la fecha de inicio no corresponde: revisá el contrato' };
  if(au.sinFechas) return { au, error: 'Falta fecha de inicio o tipo de contrato' };
  if(!(Number(a.alq_inicial) > 0)) return { au, error: 'Falta el alquiler inicial: cargalo con "✎ Editar datos de la unidad"' };
  if(!axICL) return { au, error: axICLError ? 'No se pudo obtener el ICL' : 'Buscando ICL…' };
  const pasos = axCadenaICL(a, au.fechaAjuste);
  if(!pasos || pasos.length < 2) return { au, error: 'No hay ICL publicado para alguna de las fechas del contrato' };
  const ult = pasos[pasos.length - 1], prev = pasos[pasos.length - 2];
  const cargado = axImporte(a);
  return {
    au, pasos, ini: prev.icl, fin: ult.icl, coef: ult.icl.valor / prev.icl.valor,
    // "Anterior" es lo que el inquilino paga hoy (puede ser un monto acordado); el nuevo sale del ICL
    anterior: cargado > 0 ? cargado : prev.monto, nuevo: ult.monto, provisorio: !ult.icl.exacto,
    anteriorICL: prev.monto,
    // El monto cargado no coincide con el que corresponde al período anterior según ICL
    distinto: Math.abs(cargado - prev.monto) > 1 ? cargado : null,
  };
}

// ---------- render ----------
function axUnidadesTab(tab){ return axAlq.filter(a => a.activo !== false && !axEsHija(a) && axTabDe(a) === tab); }

function axTotales(lista){
  const t = { ars: 0, usd: 0, cobArs: 0, cobUsd: 0, hon: 0, honCob: 0, n: 0, deuda: 0, deudaUsd: 0, deudores: 0, etapas: { sin_avisar: 0, avisado: 0, parcial: 0, pagado: 0, rendido: 0 } };
  lista.forEach(a => {
    const p = axPagoDe(a.id), e = axEtapa(p), usd = axEsUSD(a);
    const c = axCalculoMes(a), monto = axTotalMes(a);
    // Honorarios MAO del mes (sobre el neto, en pesos)
    const hon = usd ? 0 : axHonorarios(a, c.base);
    t.hon += hon;
    if(e === 'pagado' || e === 'rendido') t.honCob += hon;
    t.n++; t.etapas[e] = (t.etapas[e] || 0) + 1;
    if(usd) t.usd += monto; else t.ars += monto;
    if(e === 'pagado' || e === 'rendido'){
      const cob = Number(p?.monto_cobrado) || monto;
      if(usd) t.cobUsd += cob; else t.cobArs += cob;
    }
    if(e === 'parcial'){ const cob = Number(p?.monto_cobrado) || 0; if(usd) t.cobUsd += cob; else t.cobArs += cob; }
    const d = axDeudaTotal(a);
    if(d > 0){ t.deudores++; if(usd) t.deudaUsd += d; else t.deuda += d; }
  });
  return t;
}
function axTotalesHTML(t){
  const usd = t.usd > 0 || t.cobUsd > 0;
  return `<span>Esperado <b>${axPesos(t.ars)}</b>${usd ? ` + <b>${axUSD(t.usd)}</b>` : ''}</span>
    <span style="margin-left:12px">Cobrado <b style="color:var(--green)">${axPesos(t.cobArs)}</b>${usd ? ` + <b style="color:var(--green)">${axUSD(t.cobUsd)}</b>` : ''}</span>
    ${t.deudores ? `<span style="margin-left:12px">Deuda <b style="color:var(--red)">${axPesos(t.deuda)}</b></span>` : ''}
    ${t.hon ? `<span style="margin-left:12px">Honorarios <b style="color:var(--blue)">${axPesos(t.honCob)}</b> de ${axPesos(t.hon)}</span>` : ''}`;
}

function axFiltrar(lista){
  const q = axNorm(axBusqueda);
  return lista.filter(a => {
    if(q && !axNorm(`${a.unidad} ${axEdificio(a)} ${a.inquilino} ${a.propietario} ${a.cobra}`).includes(q)) return false;
    if(axFiltroEtapa === 'sin_tel'){ if(axTelGrupo(a)) return false; }
    else if(axFiltroEtapa === 'deuda'){ if(!(axDeudaTotal(a) > 0)) return false; }
    else if(axFiltroEtapa && axEtapa(axPagoDe(a.id)) !== axFiltroEtapa) return false;
    if(axSoloAumento && !axAumentoCobro(a, axPeriodo)) return false;
    return true;
  });
}

function renderAlquileres(){
  if(axTab === 'deudores') return axRenderDeudores();
  if(axTab === 'servicios') return axRenderServicios();
  const activasTab = axUnidadesTab(axTab).filter(axActiva);
  const vacantes = axUnidadesTab(axTab).filter(a => !axActiva(a));
  const tot = axTotales(activasTab);
  const lista = axFiltrar(activasTab);

  const grupos = {};
  lista.forEach(a => { const k = a.propietario || 'Sin propietario'; (grupos[k] = grupos[k] || []).push(a); });
  const ordenGrupos = Object.keys(grupos).sort((x, y) => x === 'Sin propietario' ? 1 : y === 'Sin propietario' ? -1 : x.localeCompare(y, 'es'));

  const conAumento = activasTab.filter(a => axAumentoCobro(a, axPeriodo));
  const chip = (val, label, n) => `<button class="btn-sm" onclick="axFiltroEtapa='${val}';renderAlquileres()" style="${axFiltroEtapa === val ? 'background:var(--text);color:white;border-color:var(--text)' : ''}">${label}${n !== undefined ? ` · ${n}` : ''}</button>`;
  const sinTel = activasTab.filter(a => !axTelGrupo(a)).length;

  document.getElementById('main').innerHTML = `
    ${axHeaderHTML()}
    ${axAvisosBase()}
    ${axTabsHTML()}
    <div class="stats" style="grid-template-columns:repeat(8,1fr)">
      <div class="stat-card"><div class="stat-label">Unidades</div><div class="stat-value">${tot.n}</div></div>
      <div class="stat-card"><div class="stat-label">Sin avisar</div><div class="stat-value">${tot.etapas.sin_avisar}</div></div>
      <div class="stat-card" style="background:${AX_ETAPAS.avisado.bg}"><div class="stat-label">Avisados</div><div class="stat-value">${tot.etapas.avisado}</div></div>
      <div class="stat-card" style="background:${AX_ETAPAS.pagado.bg}"><div class="stat-label">Pagados</div><div class="stat-value green">${tot.etapas.pagado}</div></div>
      <div class="stat-card"><div class="stat-label">Esperado</div><div class="stat-value" style="font-size:14px">${axPesos(tot.ars)}${tot.usd ? `<br>${axUSD(tot.usd)}` : ''}</div></div>
      <div class="stat-card"><div class="stat-label">Cobrado</div><div class="stat-value green" style="font-size:14px">${axPesos(tot.cobArs)}${tot.usd ? `<br>${axUSD(tot.cobUsd)}` : ''}</div></div>
      <div class="stat-card" style="background:var(--blue-bg)" title="Honorarios de MAO del mes: cobrados (de los alquileres pagados) / total esperado"><div class="stat-label">Honorarios MAO</div><div class="stat-value" style="font-size:14px;color:var(--blue)">${axPesos(tot.honCob)}<div style="font-size:11px;font-weight:400;color:var(--text-2)">de ${axPesos(tot.hon)}</div></div></div>
      <div class="stat-card" style="cursor:pointer;${tot.deudores ? 'background:var(--red-bg)' : ''}" onclick="axFiltroEtapa='deuda';renderAlquileres()" title="Deuda de meses anteriores (con intereses). Tocá para ver solo los que deben"><div class="stat-label">Deuda anterior</div><div class="stat-value" style="font-size:14px;${tot.deudores ? 'color:var(--red)' : ''}">${axPesos(tot.deuda)}${tot.deudaUsd ? `<br>${axUSD(tot.deudaUsd)}` : ''}<div style="font-size:11px;font-weight:400;color:var(--text-2)">${tot.deudores} deudor${tot.deudores !== 1 ? 'es' : ''}</div></div></div>
    </div>
    ${axRenderICL(conAumento)}
    <div class="toolbar" style="flex-wrap:wrap">
      <div class="search-wrap"><span class="search-icon">⌕</span><input id="ax-buscar" placeholder="Buscar unidad, inquilino, propietario..." value="${axH(axBusqueda)}" oninput="axBusqueda=this.value;axRenderLista()"></div>
      ${chip('', 'Todos')}${chip('sin_avisar','Sin avisar',tot.etapas.sin_avisar)}${chip('avisado','Avisados',tot.etapas.avisado)}${tot.etapas.parcial ? chip('parcial','Pago parcial',tot.etapas.parcial) : ''}${chip('pagado','Pagados',tot.etapas.pagado)}${chip('rendido','Rendidos',tot.etapas.rendido)}${chip('sin_tel','📵 Sin teléfono',sinTel)}${chip('deuda','💸 Con deuda',tot.deudores)}
      <label style="font-size:12px;color:var(--text-2);display:flex;align-items:center;gap:5px;cursor:pointer"><input type="checkbox" ${axSoloAumento?'checked':''} onchange="axSoloAumento=this.checked;renderAlquileres()"> Solo con aumento</label>
    </div>
    <div style="font-size:11px;color:var(--text-3);margin:-4px 0 12px">Atajos: ↑ ↓ moverse · Enter abrir · W WhatsApp · A avisado · P pagado</div>
    <div id="ax-lista">${axRenderGrupos(ordenGrupos, grupos)}</div>
    ${vacantes.length ? `<details style="margin-top:20px"><summary style="cursor:pointer;font-size:13px;color:var(--text-2)">Vacantes / sin importe (${vacantes.length})</summary>
      <div class="table-wrap" style="margin-top:8px"><table><tbody>
        ${vacantes.map(a => `<tr><td>${axH(axNombreUnidad(a))}</td><td style="color:var(--text-3)">${axH(a.tipo_unidad || a.tipo || '')}</td><td>${axH(a.propietario || '—')}</td><td style="color:var(--text-3)">${axH(a.inquilino || 'Sin inquilino')}</td></tr>`).join('')}
      </tbody></table></div></details>` : ''}`;
}

function axRenderLista(){
  const activasTab = axUnidadesTab(axTab).filter(axActiva);
  const lista = axFiltrar(activasTab);
  const grupos = {};
  lista.forEach(a => { const k = a.propietario || 'Sin propietario'; (grupos[k] = grupos[k] || []).push(a); });
  const orden = Object.keys(grupos).sort((x, y) => x === 'Sin propietario' ? 1 : y === 'Sin propietario' ? -1 : x.localeCompare(y, 'es'));
  document.getElementById('ax-lista').innerHTML = axRenderGrupos(orden, grupos);
}

function axRenderGrupos(orden, grupos){
  if(orden.length === 0) return '<div style="padding:30px;text-align:center;color:var(--text-3);font-size:13px">No hay unidades para mostrar</div>';
  return orden.map(prop => {
    const items = grupos[prop];
    const t = axTotales(items);
    const p = axPropDe(items[0]);
    const faltaPago = axTab !== 'prop' && !(p && (p.datos_pago_wa || p.cbu || p.nro_cuenta || p.alias_mao));
    return `<div class="group-section" style="margin-bottom:18px">
      <div class="group-header" style="flex-wrap:wrap">
        <span class="group-title">${axH(prop)}</span>
        <span class="group-count">${items.length}</span>
        <span style="font-size:12px;color:var(--text-2);margin-left:auto">${axTotalesHTML(t)}</span>
        ${p ? `<button class="btn-sm" onclick="axEditarDatosPago(${p.id})" title="Texto de datos de pago que va al final del WhatsApp" style="${faltaPago ? 'border-color:var(--orange);color:var(--orange)' : ''}">✎ Datos de pago${faltaPago ? ' ⚠' : ''}</button>` : ''}
      </div>
      <div class="table-wrap" style="border-radius:0 0 var(--radius) var(--radius);border-top:none">
        <table>
          <thead><tr>
            <th>Unidad</th><th style="width:20%">Inquilino</th><th style="width:128px">Contrato</th>
            <th style="width:130px">Este mes</th><th style="width:96px">Estado</th><th style="width:280px">Acciones</th>
          </tr></thead>
          <tbody>${items.map(axRenderFila).join('')}</tbody>
        </table>
      </div>
    </div>`;
  }).join('');
}

// Aviso de contrato vencido o por vencer (60 días)
function axVence(a){
  const fin = axParseFecha(a.fin_contrato); if(!fin) return '';
  const dias = Math.round((fin - new Date()) / 864e5);
  if(dias < 0) return ` <span title="Contrato vencido el ${axFmtFecha(fin)}" style="font-size:11px;color:var(--red)">⏳ vencido</span>`;
  if(dias <= 60) return ` <span title="Contrato vence el ${axFmtFecha(fin)}" style="font-size:11px;color:var(--orange)">⏳ vence ${axFmtFecha(fin)}</span>`;
  return '';
}

function axRenderFila(a){
  const p = axPagoDe(a.id), e = axEtapa(p), et = AX_ETAPAS[e] || AX_ETAPAS.sin_avisar;
  const c = axCalculoMes(a), au = axAumentoCobro(a, axPeriodo);
  const tel = axTelGrupo(a);
  const abierta = axOpen === a.id;
  const aumentoIcon = au && au.cobroSiguiente && !au.yaIncluido ? ` <span title="Aumento el ${axFmtFecha(au.fechaAjuste)}: se cobra con diferencia el mes que viene" style="color:var(--text-3)">⬆</span>` : au && !au.soloTexto ? (c.aj || au.yaIncluido ? ' <span title="Aumento ICL aplicado" style="color:var(--green)">⬆</span>' : ' <span title="Le toca aumento: revisalo arriba" style="color:var(--accent)">⬆</span>') : '';
  const comp = p?.comprobante_url ? ` <a href="${axH(p.comprobante_url)}" target="_blank" onclick="event.stopPropagation()" title="El inquilino subió comprobante">📎</a>` : '';
  return `<tr id="ax-row-${a.id}" data-ax="${a.id}" tabindex="0" onclick="axToggle(${a.id})" style="background:${et.bg}">
      <td style="background:${et.bg}" title="${axH(axNombreUnidad(a))}"><b style="font-weight:500">${axH(axNombreUnidad(a))}</b>${aumentoIcon}${axVence(a)}</td>
      <td style="background:${et.bg}" title="${axH(a.inquilino)}">${axH(a.inquilino)}${tel ? '' : ' <span title="Falta teléfono">📵</span>'}${axGrupoInquilino(a).length > 1 ? ` <span title="Un solo WhatsApp para sus ${axGrupoInquilino(a).length} unidades" style="font-size:11px;color:var(--blue)">👥${axGrupoInquilino(a).length}</span>` : ''}</td>
      <td style="background:${et.bg};font-size:11px;color:var(--text-2)" title="${axH(axTipoContrato(a))}">${axH(axTipoContrato(a) ? axTipoContrato(a).charAt(0) + axTipoContrato(a).slice(1).toLowerCase() : '—')}</td>
      <td style="background:${et.bg};font-weight:500">${axMonto(axTotalMes(a), c.usd)}${comp}${axExtraMes(a) ? `<div style="font-size:11px;font-weight:400;color:var(--text-2)" title="Se descuentan expensas extraordinarias">− exp. extraord. ${axMonto(axExtraMes(a), c.usd)}</div>` : ''}${e === 'parcial' ? `<div style="font-size:11px;font-weight:400;color:#8A4A00">resta ${axMonto(axSaldoMes(a), c.usd)}</div>` : ''}${axDeudaTotal(a) > 0 ? `<div style="font-size:11px;font-weight:500;color:var(--red)" title="Deuda de meses anteriores (con intereses)">💸 debe ${axMonto(axDeudaTotal(a), c.usd)}</div>` : ''}</td>
      <td style="background:${et.bg}"><span class="badge" style="background:${et.pill};color:${et.color}">${et.label}</span></td>
      <td style="background:${et.bg}" onclick="event.stopPropagation()">
        <div style="display:flex;gap:4px">
          <button class="btn-sm" onclick="axWhatsApp(${a.id})" title="Abrir WhatsApp con el mensaje (W)" style="color:#128C4A;border-color:#9ED9B5">💬 WhatsApp</button>
          <button class="btn-sm" onclick="axSetEtapa(${a.id},'avisado')" ${e !== 'sin_avisar' ? 'disabled style="opacity:.35"' : ''}>Avisado</button>
          <button class="btn-sm" onclick="axPagado(${a.id})" ${(e === 'pagado' || e === 'rendido') && !(axDeudaTotal(a) > 0) ? 'disabled style="opacity:.35"' : ''}>${axDeudaTotal(a) > 0 || e === 'parcial' ? 'Registrar pago' : 'Pagado'}</button>
        </div>
      </td>
    </tr>
    ${abierta ? `<tr class="ax-detalle"><td colspan="6" style="white-space:normal;background:var(--bg);padding:16px 18px;cursor:default" onclick="event.stopPropagation()">${axRenderDetalle(a)}</td></tr>` : ''}`;
}

function axRenderDetalle(a){
  const p = axPagoDe(a.id), e = axEtapa(p), c = axCalculoMes(a), usd = c.usd;
  const tel = axWAPhone(a.tel_inquilino);
  const msg = axMsgEditado[a.id] ?? axMensaje(a);
  const au = axAumentoCobro(a, axPeriodo);
  const honor = usd ? 0 : axHonorarios(a, c.base);
  const linea = (k, v) => `<div style="display:flex;justify-content:space-between;gap:10px;font-size:12px;padding:3px 0"><span style="color:var(--text-3)">${k}</span><span style="text-align:right">${v}</span></div>`;
  return `<div style="display:grid;grid-template-columns:1fr 1.3fr;gap:20px">
    <div>
      <div style="font-size:11px;font-weight:500;color:var(--text-3);text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px">Este mes</div>
      ${c.aj ? linea('Aumento ICL', `${axMonto(c.aj.importe_anterior, usd)} → <b>${axMonto(c.aj.importe_nuevo, usd)}</b> (coef. ${Number(c.aj.coeficiente).toFixed(4)})`) : ''}
      ${au && !c.aj ? linea('Aumento', '<span style="color:var(--orange)">Le toca aumento y todavía no está confirmado</span>') : ''}
      ${c.aj && c.diasAnt > 0 ? `<label style="display:flex;gap:6px;align-items:center;font-size:12px;color:var(--text-2);margin:4px 0"><input type="checkbox" ${axPartido[a.id] !== false ? 'checked' : ''} onchange="axPartido[${a.id}]=this.checked;delete axMsgEditado[${a.id}];renderAlquileres()"> Mes partido (rige desde el día ${c.diasAnt + 1})</label>` : ''}
      ${c.diferencia ? linea(`Diferencia desde ${axFmtFecha(c.diferencia.desde)} (${c.diferencia.dias} días)`, axMonto(c.diferencia.monto, usd)) : ''}
      ${c.lineas ? c.lineas.map(l => linea(`${l.dias} días x ${axMonto(l.diario, usd)}`, axMonto(l.subtotal, usd))).join('') : ''}
      ${c.iva ? linea('Alquiler (neto)', axMonto(c.base, usd)) + linea(`IVA ${(c.ivaPct * 100).toLocaleString('es-AR')}%`, axMonto(c.iva, usd)) : ''}
      ${linea(c.iva ? 'Total con IVA' : 'Total alquiler', `<b>${axMonto(c.total, usd)}</b>`)}
      ${axExtraMes(a) ? linea('Menos expensas extraordinarias', `−${axMonto(axExtraMes(a), usd)}`) + linea('Total a cobrar', `<b>${axMonto(axTotalMes(a), usd)}</b>`) : ''}
      ${honor ? linea('Honorarios MAO', axPesos(honor)) : ''}
      ${axRenderDeudaDetalle(a)}
      <div style="font-size:11px;font-weight:500;color:var(--text-3);text-transform:uppercase;letter-spacing:.5px;margin:12px 0 6px">Datos</div>
      <div style="display:flex;gap:6px;align-items:center;font-size:12px;padding:3px 0">
        <span style="color:var(--text-3);min-width:110px">Tel. inquilino</span>
        <input id="ax-tel-${a.id}" value="${axH(a.tel_inquilino || '')}" placeholder="Ej: 341 555-1234" style="flex:1;padding:5px 8px;border:1px solid ${tel ? 'var(--border)' : 'var(--orange)'};border-radius:6px;font-family:inherit;font-size:12px;background:var(--surface)" onkeydown="if(event.key==='Enter')axGuardarTel(${a.id})">
        <button class="btn-sm" onclick="axGuardarTel(${a.id})">Guardar</button>
      </div>
      ${!tel ? '<div style="font-size:11px;color:var(--orange);margin-bottom:4px">Falta un teléfono válido para WhatsApp (10 dígitos con característica).</div>' : ''}
      ${linea('Email', axH(a.email_inquilino || '—'))}
      ${linea('Cobra', axH(a.cobra || '—'))}
      ${linea('Contrato', `${axH(axTipoContrato(a) || '—')} · ${axFmtFecha(axParseFecha(a.inicio_contrato))} → ${axFmtFecha(axParseFecha(a.fin_contrato))}`)}
      ${linea('Mes aumento', axH(a.mes_aumento || '—'))}
      ${Number(a.interes_mensual) > 0 ? linea('Interés por mora', `${(Number(a.interes_mensual) * 100).toLocaleString('es-AR')}% por mes de atraso`) : ''}
      <div style="display:flex;gap:6px;align-items:center;margin-top:12px;font-size:12px">
        <span style="color:var(--text-3)">Corregir estado:</span>
        <select onchange="axSetEtapa(${a.id}, this.value, true)" style="padding:4px 6px;border:1px solid var(--border);border-radius:6px;font-family:inherit;font-size:12px">
          ${Object.entries(AX_ETAPAS).filter(([k]) => k !== 'parcial' || k === e).map(([k, v]) => `<option value="${k}" ${k === e ? 'selected' : ''}>${v.label}</option>`).join('')}
        </select>
        <button class="btn-sm" onclick="axSetEtapa(${a.id},'rendido')" ${e === 'rendido' ? 'disabled style="opacity:.35"' : ''}>Marcar rendido</button>
      </div>
      <button class="btn-sm" style="margin-top:10px" onclick="axEditarUnidad(${a.id})">✎ Editar datos de la unidad</button>
    </div>
    <div>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
        <span style="font-size:11px;font-weight:500;color:var(--text-3);text-transform:uppercase;letter-spacing:.5px">Mensaje de WhatsApp</span>
        ${axMsgEditado[a.id] !== undefined ? `<button class="btn-sm" onclick="delete axMsgEditado[${a.id}];renderAlquileres()">↺ Regenerar</button>` : ''}
      </div>
      ${axGrupoInquilino(a).length > 1 ? `<div style="font-size:11px;color:var(--blue);margin-bottom:6px">👥 Este mensaje incluye sus ${axGrupoInquilino(a).length} unidades: ${axGrupoInquilino(a).map(x => axH(axNombreUnidad(x))).join(' · ')}. "Avisado" las marca a todas.</div>` : ''}
      <textarea id="ax-msg-${a.id}" oninput="axMsgEditado[${a.id}]=this.value" style="width:100%;min-height:230px;padding:10px;border:1px solid var(--border);border-radius:8px;font-family:inherit;font-size:12px;line-height:1.45;background:var(--surface);box-sizing:border-box;resize:vertical">${axH(msg)}</textarea>
      <div style="display:flex;gap:8px;margin-top:8px">
        <button onclick="axWhatsApp(${a.id})" style="flex:1;padding:9px;background:#25D366;color:white;border:none;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit">💬 Abrir WhatsApp</button>
        <button onclick="axCopiarMsg(${a.id})" class="btn-sm">Copiar</button>
      </div>
    </div>
  </div>`;
}

function axRenderICL(conAumento){
  if(conAumento.length === 0) return '';
  const filas = conAumento.map(a => ({ a, c: axCalculoICL(a) }));
  const pendientes = filas.filter(f => !f.c.confirmado && !f.c.error && !f.c.info && !f.c.incluido);
  const confirmados = filas.filter(f => f.c.confirmado || f.c.incluido).length;
  const proximos = filas.filter(f => f.c.info).length;
  const td = 'style="padding:8px 10px;font-size:12px"';
  const rows = filas.map(({ a, c }) => {
    const au = c.au;
    const aviso = au.diferencia ? `<div style="font-size:10px;color:var(--orange)">⚠ ${au.porCalendario ? 'Por fecha de inicio le toca, pero MES AUMENTO no lo dice' : 'MES AUMENTO lo dice, pero por fecha de inicio no le toca'}</div>` : '';
    let cols;
    if(c.info){
      cols = `<td ${td}>rige ${axFmtFecha(au.fechaAjuste)}</td><td ${td} colspan="6" style="padding:8px 10px;font-size:12px;color:var(--text-3)">${axH(c.info)}</td>`;
    } else if(c.incluido){
      cols = `<td ${td}>${axFmtFecha(au.fechaBase)} → ${axFmtFecha(au.fechaAjuste)}</td><td ${td} colspan="4" style="padding:8px 10px;font-size:12px;color:var(--text-3)">Ya incluido en el importe actual (cargado del Excel)</td>
        <td ${td}>${axPesos(axImporte(a))}</td><td ${td}><span class="badge" style="background:#D6EDC4;color:#3B6D11">✓ Incluido</span></td>`;
    } else if(c.confirmado){
      cols = `<td ${td}>${axFmtFecha(axParseFecha(c.aj.fecha_base))} → ${axFmtFecha(axParseFecha(c.aj.fecha_ajuste))}</td>
        <td ${td}>${Number(c.aj.icl_inicial).toFixed(2)}</td><td ${td}>${Number(c.aj.icl_final).toFixed(2)}</td>
        <td ${td}>${Number(c.aj.coeficiente).toFixed(4)}</td><td ${td}>${axPesos(c.aj.importe_anterior)}</td><td ${td}><b>${axPesos(c.aj.importe_nuevo)}</b></td>
        <td ${td}><span class="badge" style="background:#D6EDC4;color:#3B6D11">✓ Aplicado</span> <button class="btn-sm" onclick="axDeshacerICL(${a.id})" title="Volver al importe anterior">Deshacer</button></td>`;
    } else if(c.error){
      cols = `<td ${td} colspan="6" style="padding:8px 10px;font-size:12px;color:var(--text-3)">${axH(c.error)}${au.fechaAjuste ? ` · rige desde ${axFmtFecha(au.fechaAjuste)}` : ''}</td><td ${td}></td>`;
    } else {
      const pasosTxt = c.pasos.map(p => `${axFmtFecha(p.fecha)}: ICL ${p.icl.valor.toFixed(2)} → ${axPesos(p.monto)}`).join('\n');
      cols = `<td ${td} title="${axH('Cálculo desde el inicio (como el COCIR):\n' + pasosTxt)}">${axFmtFecha(c.pasos[c.pasos.length - 2].fecha)} → ${axFmtFecha(au.fechaAjuste)}
          <div style="font-size:10px;color:var(--text-3)">${c.pasos.length - 1}° aumento desde ${axFmtFecha(c.pasos[0].fecha)} ($${Number(a.alq_inicial).toLocaleString('es-AR')})</div>
          ${c.distinto !== null ? `<div style="font-size:10px;color:var(--orange)">⚠ cargado ${axPesos(c.distinto)}; según ICL el período anterior era ${axPesos(c.anteriorICL)}</div>` : ''}</td>
        <td ${td} title="ICL del ${c.ini.fecha}">${c.ini.valor.toFixed(2)}</td>
        <td ${td} title="ICL del ${c.fin.fecha}">${c.fin.valor.toFixed(2)}${c.provisorio ? `<div style="font-size:10px;color:var(--orange)">provisorio: último publicado ${axFmtFecha(axParseFecha(c.fin.fecha))}</div>` : ''}</td>
        <td ${td}><b>${c.coef.toFixed(4)}</b> <span style="color:var(--text-3)">(+${((c.coef - 1) * 100).toFixed(2)}%)</span></td>
        <td ${td}>${axPesos(c.anterior)}</td><td ${td}><b style="color:var(--green)">${axPesos(c.nuevo)}</b></td>
        <td ${td}><button class="btn-sm" onclick="axConfirmarICL([${a.id}])" style="border-color:var(--green);color:var(--green)">✓ Confirmar</button></td>`;
    }
    return `<tr style="cursor:default"><td ${td}><b style="font-weight:500">${axH(axNombreUnidad(a))}</b><div style="font-size:11px;color:var(--text-3)">${axH(a.inquilino)} · ${axH(axTipoContrato(a))}</div>${aviso}</td>${cols}</tr>`;
  }).join('');
  return `<details ${pendientes.length || filas.some(f => f.c.error) ? 'open' : ''} style="background:#FFFDF5;border:1px solid var(--accent);border-radius:var(--radius);padding:12px 16px;margin-bottom:18px">
    <summary style="cursor:pointer;font-size:13px"><span style="color:var(--accent);font-weight:600">⬆ Aumentos ICL de ${axFmtPeriodo(axPeriodo)}</span>
      <span style="color:var(--text-2);margin-left:8px">${filas.length - proximos} a cobrar este mes · ${confirmados} aplicada${confirmados !== 1 ? 's' : ''}${proximos ? ` · ${proximos} rigen después del ${AX_DIA_LIMITE} (se cobran el mes que viene)` : ''}</span>
      ${axICLCargando ? '<span style="color:var(--text-3);margin-left:8px">consultando BCRA…</span>' : ''}
      ${axICLError ? `<span style="color:var(--red);margin-left:8px">No se pudo consultar el ICL del BCRA (${axH(axICLError)}). <a href="#" onclick="event.preventDefault();axICL=null;axCargarICL()">Reintentar</a></span>` : ''}
    </summary>
    <div style="font-size:11px;color:var(--text-3);margin:8px 0">Fuente: ICL oficial del BCRA. Coeficiente = ICL del día en que rige el aumento ÷ ICL del último aumento (o del inicio). Si rige del 1 al ${AX_DIA_LIMITE} se cobra proporcional este mes; si rige después del ${AX_DIA_LIMITE}, se cobra el mes siguiente con la diferencia. No se aplica a contratos FIJO, SIN CONTRATO ni en USD.</div>
    <div class="table-wrap ax-scroll"><table style="table-layout:auto">
      <thead><tr><th>Unidad</th><th>Período</th><th>ICL inicial</th><th>ICL final</th><th>Coeficiente</th><th>Anterior</th><th>Nuevo</th><th></th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
    ${pendientes.length > 1 ? `<div style="text-align:right;margin-top:10px"><button class="btn-primary" onclick="axConfirmarICL([${pendientes.map(f => f.a.id).join(',')}])">✓ Confirmar los ${pendientes.length} aumentos</button></div>` : ''}
  </details>`;
}


function axHeaderHTML(){
  return `
    <div class="page-header" style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap">
      <div><h2>Alquileres</h2><p>Circuito del mes: aumento → aviso → cobro → rendición</p></div>
      <div style="display:flex;gap:8px;align-items:center">
        <button class="btn-sm" onclick="axAbrirImportador()">⇪ Importar Excel</button>
        <div style="display:flex;align-items:center;gap:8px;background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:8px 14px">
          <button onclick="axCambiarMes(-1)" style="background:none;border:none;cursor:pointer;font-size:16px;color:var(--text-2)">‹</button>
          <span style="font-weight:500;font-size:14px;min-width:130px;text-align:center">${axFmtPeriodo(axPeriodo)}</span>
          <button onclick="axCambiarMes(1)" style="background:none;border:none;cursor:pointer;font-size:16px;color:var(--text-2)">›</button>
        </div>
      </div>
    </div>`;
}
function axAvisosBase(){
  const caja = txt => `<div style="background:var(--red-bg);color:var(--red);border-radius:var(--radius);padding:12px 16px;margin-bottom:16px;font-size:13px">${txt}</div>`;
  if(!axSchemaOK) return caja('⚠ Falta preparar la base de datos: corré el script <b>sql/2026-10_alquileres_parte1.sql</b> en Supabase → SQL Editor. Hasta entonces no se pueden guardar avisos ni aumentos.');
  if(!axDeudaOK) return caja('⚠ Para llevar el registro de deudas falta correr el script <b>sql/2026-10_deudas.sql</b> en Supabase → SQL Editor.');
  return '';
}
function axDeudores(){ return axAlq.filter(a => !axEsHija(a) && axDeudaTotal(a) > 0); }
function axTabsHTML(){
  const cuenta = tab => tab === 'deudores' ? axDeudores().length : tab === 'servicios' ? axAlq.filter(a => axActiva(a) && axServPasa(a, 'comprobante') && axServiciosDe(a).length).length : axUnidadesTab(tab).filter(axActiva).length;
  return `<div style="display:flex;gap:4px;border-bottom:1px solid var(--border);margin-bottom:16px">
      ${[['db','DB'],['dbgb','DB + GB'],['prop','Propietarios'],['servicios','🧾 Impuestos y servicios'],['deudores','💸 Deudores']].map(([k,l]) => `
        <button onclick="axTab='${k}';axOpen=null;axFiltroEtapa='';renderAlquileres()" style="padding:10px 18px;border:none;background:none;cursor:pointer;font-family:inherit;font-size:14px;font-weight:${axTab===k?600:400};color:${axTab===k?'var(--text)':'var(--text-3)'};border-bottom:2px solid ${axTab===k?'var(--accent)':'transparent'};margin-bottom:-1px;${k === 'servicios' ? 'margin-left:auto' : ''}" ${k === 'servicios' ? 'title="Unidades con boletas o comprobantes pendientes"' : ''}>${l} <span style="font-size:11px;color:${k === 'deudores' && cuenta(k) ? 'var(--red)' : 'var(--text-3)'}">${cuenta(k)}</span></button>`).join('')}
    </div>`;
}

// Pestaña con solo los que deben meses anteriores (de todos los propietarios)
function axRenderDeudores(){
  const lista = axDeudores().sort((x, y) => axDeudaTotal(y) - axDeudaTotal(x));
  const tot = lista.reduce((s, a) => { s[axEsUSD(a) ? 'usd' : 'ars'] += axDeudaTotal(a); return s; }, { ars: 0, usd: 0 });
  const tabNombre = { db: 'DB', dbgb: 'DB + GB', prop: 'Propietarios' };
  const td = 'style="padding:10px;font-size:12px;vertical-align:top;white-space:normal"';
  const filas = lista.map(a => {
    const items = axDeudaItems(a), usd = axEsUSD(a);
    return `<tr style="cursor:default">
      <td ${td}><b style="font-weight:500">${axH(axNombreUnidad(a))}</b><div style="font-size:11px;color:var(--text-3)">${axH(a.propietario || '—')} · ${tabNombre[axTabDe(a)]}${a.activo === false ? ' · ya no está en el listado' : ''}</div></td>
      <td ${td}>${axH(a.inquilino || '—')}</td>
      <td ${td}>${items.map(it => `<div>${axH(it.concepto)} ${axFmtPeriodo(it.periodo)}: <b>${axMonto(it.saldo, usd)}</b>${it.interes ? ` <span style="color:var(--red)">+ int. ${axMonto(it.interes, usd)}</span> <span style="color:var(--text-3)">(${it.meses} mes${it.meses !== 1 ? 'es' : ''})</span>` : ''}</div>`).join('')}</td>
      <td ${td}><b style="color:var(--red)">${axMonto(axDeudaTotal(a), usd)}</b></td>
      <td ${td}>${axSaldoMes(a) ? axMonto(axSaldoMes(a), usd) : '<span style="color:var(--green)">✓</span>'}</td>
      <td ${td}><b>${axMonto(axAPagar(a), usd)}</b></td>
      <td ${td}><div style="display:flex;gap:4px;flex-wrap:wrap">
        <button class="btn-sm" onclick="axWhatsApp(${a.id})" style="color:#128C4A;border-color:#9ED9B5">💬 WhatsApp</button>
        <button class="btn-sm" onclick="axModalPago(${a.id})">Registrar pago</button>
        ${a.activo !== false ? `<button class="btn-sm" onclick="axTab='${axTabDe(a)}';axOpen=${a.id};axFiltroEtapa='';renderAlquileres();document.getElementById('ax-row-${a.id}')?.scrollIntoView({block:'center'})">Ver unidad</button>` : ''}
      </div></td></tr>`;
  }).join('');
  document.getElementById('main').innerHTML = `
    ${axHeaderHTML()}
    ${axAvisosBase()}
    ${axTabsHTML()}
    <div class="stats" style="grid-template-columns:repeat(3,1fr)">
      <div class="stat-card" style="background:var(--red-bg)"><div class="stat-label">Deudores</div><div class="stat-value" style="color:var(--red)">${lista.length}</div></div>
      <div class="stat-card"><div class="stat-label">Deuda anterior (con intereses)</div><div class="stat-value" style="font-size:16px;color:var(--red)">${axPesos(tot.ars)}${tot.usd ? `<br>${axUSD(tot.usd)}` : ''}</div></div>
      <div class="stat-card"><div class="stat-label">Total a cobrar (deuda + ${axFmtPeriodo(axPeriodo)})</div><div class="stat-value" style="font-size:16px">${axPesos(lista.filter(a => !axEsUSD(a)).reduce((s, a) => s + axAPagar(a), 0))}</div></div>
    </div>
    <div style="font-size:12px;color:var(--text-3);margin:-4px 0 12px">Desde ${axFmtPeriodo(AX_DEUDA_DESDE)} la deuda se arma sola con los meses que no quedaron pagados. La deuda anterior a eso se carga a mano desde la unidad (botón "+ Cargar deuda anterior"). Cada pago se aplica primero a lo más atrasado (primero sus intereses).</div>
    ${lista.length ? `<div class="table-wrap ax-scroll"><table style="table-layout:auto">
      <thead><tr><th>Unidad</th><th>Inquilino</th><th>Qué debe</th><th>Deuda anterior</th><th>${axFmtPeriodo(axPeriodo)}</th><th>Total</th><th></th></tr></thead>
      <tbody>${filas}</tbody></table></div>` : '<div style="padding:30px;text-align:center;color:var(--text-3);font-size:13px">No hay deudores 🎉</div>'}`;
}

// Bloque "Deuda" dentro del detalle de la unidad
function axRenderDeudaDetalle(a){
  if(!axDeudaOK) return '';
  const items = axDeudaItems(a), usd = axEsUSD(a);
  const cobros = axCobros.filter(c => c.alquiler_id === a.id).slice(0, 3);
  const tit = t => `<div style="font-size:11px;font-weight:500;color:var(--text-3);text-transform:uppercase;letter-spacing:.5px;margin:12px 0 6px">${t}</div>`;
  let h = tit('Deuda de meses anteriores');
  if(items.length === 0) h += '<div style="font-size:12px;color:var(--text-3)">No debe meses anteriores.</div>';
  items.forEach(it => {
    h += `<div style="display:flex;justify-content:space-between;gap:10px;font-size:12px;padding:3px 0">
      <span>${axH(it.concepto)} ${axFmtPeriodo(it.periodo)}${it.detalle ? ` <span style="color:var(--text-3)">(${axH(it.detalle)})</span>` : ''}
        ${it.tipo === 'deuda' && !(Number(it.ref.pagado) > 0) ? `<a href="#" onclick="event.preventDefault();axBorrarDeuda(${it.ref.id})" title="Borrar esta deuda cargada a mano" style="color:var(--text-3);margin-left:4px">✕</a>` : ''}</span>
      <span style="text-align:right"><b style="color:var(--red)">${axMonto(it.saldo, usd)}</b>${it.interes ? `<div style="font-size:11px;color:var(--text-2)">+ interés ${(it.tasa * 100).toLocaleString('es-AR')}% x ${it.meses}: ${axMonto(it.interes, usd)}</div>` : ''}</span></div>`;
  });
  if(items.length) h += `<div style="display:flex;justify-content:space-between;font-size:12px;padding:4px 0;border-top:1px solid var(--border);margin-top:2px"><span>Total con este mes</span><b>${axMonto(axAPagar(a), usd)}</b></div>`;
  h += `<div style="display:flex;gap:6px;margin-top:6px;flex-wrap:wrap">
    <button class="btn-sm" onclick="axModalDeuda(${a.id})">+ Cargar deuda anterior</button>
    <button class="btn-sm" onclick="axModalPago(${a.id})">Registrar pago (otro monto)</button></div>`;
  if(cobros.length){
    h += tit('Últimos pagos registrados');
    cobros.forEach((c, i) => {
      h += `<div style="display:flex;justify-content:space-between;gap:10px;font-size:12px;padding:3px 0">
        <span>${axFmtFecha(axParseFecha(c.fecha))} · ${axMonto(c.monto, usd)}</span>
        ${i === 0 ? `<a href="#" onclick="event.preventDefault();axAnularCobro(${c.id})" style="color:var(--text-3)" title="Deshace este pago (vuelve todo como estaba antes)">Anular</a>` : ''}</div>`;
    });
  }
  return h;
}

// ---------- registrar pagos (se aplican a lo más atrasado primero) ----------
function axPagado(id){
  const a = axAlq.find(x => x.id === id); if(!a) return;
  if(!axDeudaOK || (axDeudaItems(a).length === 0 && axEtapa(axPagoDe(id)) !== 'parcial')) return axSetEtapa(id, 'pagado');
  axModalPago(id);
}
// Reparte un monto: deuda más vieja primero (sus intereses y después el capital), y al final el mes actual
function axDistribuir(a, monto){
  let resto = Math.round(Number(monto) || 0);
  const apps = [];
  axDeudaItems(a).forEach(it => {
    const interes = Math.min(resto, it.interes); resto -= interes;
    const capital = Math.min(resto, it.saldo); resto -= capital;
    if(interes || capital || it.tasa) apps.push({ it, interes, capital });
  });
  const mes = Math.min(resto, axSaldoMes(a)); resto -= mes;
  return { apps, mes, sobra: resto };
}
function axModalPago(id){
  const a = axAlq.find(x => x.id === id); if(!a) return;
  const usd = axEsUSD(a), total = axAPagar(a);
  document.getElementById('ax-modal')?.remove();
  const m = document.createElement('div');
  m.id = 'ax-modal';
  m.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;z-index:9999;padding:20px';
  m.innerHTML = `<div style="background:var(--surface);border-radius:var(--radius);width:100%;max-width:520px;padding:20px 22px;max-height:90vh;overflow:auto">
    <div style="font-family:'DM Serif Display',serif;font-size:18px;margin-bottom:2px">Registrar pago · ${axH(axNombreUnidad(a))}</div>
    <div style="font-size:12px;color:var(--text-3);margin-bottom:12px">${axH(a.inquilino)} · debe en total <b>${axMonto(total, usd)}</b>. El pago se aplica primero a lo más atrasado.</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
      <label style="font-size:11px;color:var(--text-3)">Monto recibido (${usd ? 'USD' : '$'})<input id="ax-pago-monto" type="number" value="${total}" oninput="axPreviewPago(${a.id})" style="width:100%;padding:7px 8px;border:1px solid var(--border);border-radius:6px;font-family:inherit;font-size:14px;box-sizing:border-box"></label>
      <label style="font-size:11px;color:var(--text-3)">Fecha del pago<input id="ax-pago-fecha" type="date" value="${axISO(new Date())}" style="width:100%;padding:7px 8px;border:1px solid var(--border);border-radius:6px;font-family:inherit;font-size:14px;box-sizing:border-box"></label>
    </div>
    <div id="ax-pago-prev" style="margin-top:12px"></div>
    <div style="display:flex;gap:8px;margin-top:14px">
      <button class="btn-sm" style="flex:1;padding:9px" onclick="document.getElementById('ax-modal').remove()">Cancelar</button>
      <button class="btn-primary" style="flex:1" onclick="axGuardarPago(${a.id})">Registrar pago</button>
    </div></div>`;
  document.body.appendChild(m);
  axPreviewPago(id);
  document.getElementById('ax-pago-monto')?.select();
}
function axPreviewPago(id){
  const a = axAlq.find(x => x.id === id); if(!a) return;
  const usd = axEsUSD(a), monto = Number(document.getElementById('ax-pago-monto')?.value) || 0;
  const d = axDistribuir(a, monto);
  const fila = (k, v, falta) => `<div style="display:flex;justify-content:space-between;gap:10px;font-size:12px;padding:3px 0"><span>${k}</span><span>${v}${falta > 0 ? ` <span style="color:var(--red)">(queda debiendo ${axMonto(falta, usd)})</span>` : ' <span style="color:var(--green)">✓</span>'}</span></div>`;
  let h = '<div style="font-size:11px;font-weight:500;color:var(--text-3);text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px">Cómo se aplica</div>';
  d.apps.forEach(({ it, interes, capital }) => {
    if(it.interes) h += fila(`Intereses ${it.concepto.toLowerCase()} ${axFmtPeriodo(it.periodo)}`, axMonto(interes, usd), it.interes - interes);
    h += fila(`${it.concepto} ${axFmtPeriodo(it.periodo)}`, axMonto(capital, usd), it.saldo - capital);
  });
  if(axSaldoMes(a) > 0) h += fila(`Alquiler ${axFmtPeriodo(axPeriodo)}`, axMonto(d.mes, usd), axSaldoMes(a) - d.mes);
  if(d.sobra > 0) h += `<div style="font-size:12px;color:var(--orange);padding:3px 0">Sobran ${axMonto(d.sobra, usd)}: se registran como pagados de más en ${axFmtPeriodo(axPeriodo)}.</div>`;
  document.getElementById('ax-pago-prev').innerHTML = h;
}
const AX_PREV_PAGO = ['monto_cobrado','etapa','estado','pagado_at','fecha_pago','monto_esperado','interes_devengado','interes_calc_periodo','interes_pagado'];
const AX_PREV_DEUDA = ['pagado','interes_devengado','interes_calc_periodo','interes_pagado'];
function axCopia(o, campos){ const r = {}; campos.forEach(k => r[k] = o[k] ?? null); return r; }
async function axGuardarPago(id){
  const a = axAlq.find(x => x.id === id); if(!a) return;
  const monto = Math.round(Number(document.getElementById('ax-pago-monto')?.value) || 0);
  const fecha = document.getElementById('ax-pago-fecha')?.value || axISO(new Date());
  if(!(monto > 0)){ showToast('Poné el monto que pagó'); return; }
  const d = axDistribuir(a, monto), ahora = new Date().toISOString(), detalle = [];
  for(const { it, interes, capital } of d.apps){
    const ref = it.ref, tabla = it.tipo === 'pago' ? 'pagos_mensuales' : 'deudas';
    const prev = axCopia(ref, it.tipo === 'pago' ? AX_PREV_PAGO : AX_PREV_DEUDA);
    // Se "congela" el interés devengado hasta hoy, así lo que se paga no se vuelve a cobrar
    const upd = it.tasa ? { interes_devengado: it.devengado, interes_calc_periodo: axPeriodo, interes_pagado: (Number(ref.interes_pagado) || 0) + interes } : {};
    if(it.tipo === 'pago'){
      const cob = (Number(ref.monto_cobrado) || 0) + capital, completo = cob >= Number(ref.monto_esperado);
      Object.assign(upd, { monto_cobrado: cob, etapa: completo ? 'pagado' : 'parcial', estado: completo ? 'pagado' : 'parcial', fecha_pago: fecha, ...(completo ? { pagado_at: ahora } : {}) });
    } else upd.pagado = (Number(ref.pagado) || 0) + capital;
    const { error } = await db.from(tabla).update(upd).eq('id', ref.id);
    if(error){ showToast('Error: ' + error.message); return; }
    Object.assign(ref, upd);
    detalle.push({ tabla, id: ref.id, periodo: it.periodo, concepto: it.concepto, interes, capital, prev });
  }
  if(d.mes > 0 || d.sobra > 0){
    const p = await axAsegurarPago(a); if(!p) return;
    const prev = axCopia(p, AX_PREV_PAGO), tot = axTotalMes(a);
    const cob = (Number(p.monto_cobrado) || 0) + d.mes + d.sobra, completo = cob >= tot;
    const upd = { monto_cobrado: cob, monto_esperado: tot, etapa: completo ? 'pagado' : 'parcial', estado: completo ? 'pagado' : 'parcial', fecha_pago: fecha, ...(completo ? { pagado_at: ahora } : {}) };
    const { error } = await db.from('pagos_mensuales').update(upd).eq('id', p.id);
    if(error){ showToast('Error: ' + error.message); return; }
    Object.assign(p, upd);
    detalle.push({ tabla: 'pagos_mensuales', id: p.id, periodo: axPeriodo, concepto: 'Alquiler', interes: 0, capital: d.mes + d.sobra, prev });
  }
  const { data, error } = await db.from('cobros').insert({ alquiler_id: a.id, fecha, monto, periodo: axPeriodo, detalle }).select().single();
  if(error) showToast('El pago se aplicó pero no se guardó en el historial: ' + error.message);
  else axCobros.unshift(data);
  document.getElementById('ax-modal')?.remove();
  delete axMsgEditado[a.id];
  const queda = axAPagar(a);
  showToast(`Pago de ${axMonto(monto, axEsUSD(a))} registrado ✓${queda > 0 ? ` · queda debiendo ${axMonto(queda, axEsUSD(a))}` : ''}`);
  renderAlquileres();
}
// Deshace el último pago de la unidad (deja todo como estaba antes)
async function axAnularCobro(cid){
  const c = axCobros.find(x => x.id === cid); if(!c) return;
  const a = axAlq.find(x => x.id === c.alquiler_id);
  if(!confirm(`¿Anular el pago de ${axMonto(c.monto, a && axEsUSD(a))} del ${axFmtFecha(axParseFecha(c.fecha))}?\nLo que había pagado vuelve a figurar como deuda.`)) return;
  for(const x of [...(c.detalle || [])].reverse()){
    const { error } = await db.from(x.tabla).update(x.prev).eq('id', x.id);
    if(error){ showToast('Error: ' + error.message); return; }
  }
  const { error } = await db.from('cobros').delete().eq('id', cid);
  if(error){ showToast('Error: ' + error.message); return; }
  showToast('Pago anulado');
  loadAlquileres();
}

// ---------- cargar deuda a mano (lo anterior a noviembre 2026, expensas, etc.) ----------
function axModalDeuda(id){
  const a = axAlq.find(x => x.id === id); if(!a) return;
  const [m0, y0] = axPeriodoAnterior(axPeriodo).split('-');
  document.getElementById('ax-modal')?.remove();
  const m = document.createElement('div');
  m.id = 'ax-modal';
  m.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;z-index:9999;padding:20px';
  const est = 'width:100%;padding:7px 8px;border:1px solid var(--border);border-radius:6px;font-family:inherit;font-size:13px;box-sizing:border-box';
  m.innerHTML = `<div style="background:var(--surface);border-radius:var(--radius);width:100%;max-width:460px;padding:20px 22px">
    <div style="font-family:'DM Serif Display',serif;font-size:18px;margin-bottom:2px">Cargar deuda · ${axH(axNombreUnidad(a))}</div>
    <div style="font-size:12px;color:var(--text-3);margin-bottom:12px">${axH(a.inquilino)}. Cargá lo que quedó pendiente de cada mes (sin intereses: los intereses se calculan solos si la unidad tiene "Interés por mora").</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
      <label style="font-size:11px;color:var(--text-3)">Mes<input id="ax-d-mes" type="month" value="${y0}-${m0}" style="${est}"></label>
      <label style="font-size:11px;color:var(--text-3)">Concepto<select id="ax-d-concepto" style="${est}">${AX_CONCEPTOS.map(c => `<option>${c}</option>`).join('')}</select></label>
      <label style="font-size:11px;color:var(--text-3)">Monto pendiente (${axEsUSD(a) ? 'USD' : '$'})<input id="ax-d-monto" type="number" style="${est}"></label>
      <label style="font-size:11px;color:var(--text-3)">Aclaración (opcional)<input id="ax-d-detalle" placeholder="Ej: saldo" style="${est}"></label>
    </div>
    <div style="display:flex;gap:8px;margin-top:14px">
      <button class="btn-sm" style="flex:1;padding:9px" onclick="document.getElementById('ax-modal').remove()">Cancelar</button>
      <button class="btn-primary" style="flex:1" onclick="axGuardarDeuda(${a.id})">Guardar</button>
    </div></div>`;
  document.body.appendChild(m);
  document.getElementById('ax-d-monto')?.focus();
}
async function axGuardarDeuda(id){
  const a = axAlq.find(x => x.id === id); if(!a) return;
  const mes = document.getElementById('ax-d-mes')?.value || '';
  const monto = Math.round(Number(document.getElementById('ax-d-monto')?.value) || 0);
  if(!/^\d{4}-\d{2}$/.test(mes) || !(monto > 0)){ showToast('Completá el mes y el monto'); return; }
  const [y, m] = mes.split('-');
  const fila = { alquiler_id: a.id, inquilino: a.inquilino || null, periodo: `${m}-${y}`, concepto: document.getElementById('ax-d-concepto').value,
    detalle: document.getElementById('ax-d-detalle').value.trim() || null, monto, moneda: axEsUSD(a) ? 'USD' : 'ARS' };
  const { data, error } = await db.from('deudas').insert(fila).select().single();
  if(error){ showToast('Error: ' + error.message); return; }
  axDeudas.push(data);
  document.getElementById('ax-modal')?.remove();
  delete axMsgEditado[a.id];
  showToast('Deuda cargada ✓');
  renderAlquileres();
}
async function axBorrarDeuda(did){
  const d = axDeudas.find(x => x.id === did); if(!d) return;
  if(!confirm(`¿Borrar la deuda de ${d.concepto} ${axFmtPeriodo(d.periodo)} por ${axPesos(d.monto)}?`)) return;
  const { error } = await db.from('deudas').delete().eq('id', did);
  if(error){ showToast('Error: ' + error.message); return; }
  axDeudas = axDeudas.filter(x => x.id !== did);
  delete axMsgEditado[d.alquiler_id];
  showToast('Deuda borrada');
  renderAlquileres();
}

// ---------- impuestos y servicios ----------
// TGI, Aguas, EPE y Gas: los paga el inquilino; MAO le manda la boleta y espera el comprobante.
// Expensas: el inquilino las paga y manda el comprobante; las extraordinarias se descuentan del alquiler del mes.
// API: la paga MAO y se descuenta al propietario (queda registrada para la rendición).
const AX_SERV = [
  { k: 'TGI',      label: 'TGI',      tipo: 'boleta',   cuenta: a => a.tgi_cuenta || a.tgi_gestion },
  { k: 'AGUAS',    label: 'Aguas',    tipo: 'boleta',   cuenta: a => a.aguas },
  { k: 'EPE',      label: 'EPE',      tipo: 'boleta',   cuenta: a => a.epe_cliente },
  { k: 'GAS',      label: 'Gas',      tipo: 'boleta',   cuenta: a => a.gas_cliente },
  { k: 'API',      label: 'API',      tipo: 'api',      cuenta: a => a.api },
  { k: 'EXPENSAS', label: 'Expensas', tipo: 'expensas', cuenta: a => !!(Number(a.expensas_monto) > 0 || a.adm_contacto) },
];
let axServ = [], axServOK = true, axServFiltro = '', axServTab = '';
// Servicios de la unidad: los elegidos a mano (columna "servicios") o los que tienen número de cuenta
function axServiciosDe(a){
  if(a.servicios !== null && a.servicios !== undefined) return AX_SERV.filter(s => String(a.servicios).split(',').includes(s.k));
  return AX_SERV.filter(s => s.cuenta(a));
}
function axServDe(id, k){ return axServ.find(x => x.alquiler_id === id && x.servicio === k && x.periodo === axPeriodo); }
function axExtraMes(a){ return axServOK ? Math.round(Number(axServDe(a.id, 'EXPENSAS')?.extraordinarias) || 0) : 0; }
// Lo que se le cobra al inquilino este mes (alquiler con IVA − expensas extraordinarias)
function axTotalMes(a){ return Math.max(0, axCalculoMes(a).total - axExtraMes(a)); }
function axLista(arr){ return arr.length > 1 ? arr.slice(0, -1).join(', ') + ' y ' + arr[arr.length - 1] : arr[0] || ''; }
function axBoletasEnviadas(a){ return axServiciosDe(a).filter(s => s.tipo === 'boleta' && axServDe(a.id, s.k)?.boleta_enviada && !axServDe(a.id, s.k)?.pagado).map(s => s.label); }
// API pagada por adelantado (en general el año completo): columna api_pagada_hasta = 'MM-AAAA'
function axAPICubierta(a){ return !!a.api_pagada_hasta && axPeriodoNum(axPeriodo) <= axPeriodoNum(a.api_pagada_hasta); }
// Qué le falta mandar al inquilino
function axServFaltan(a){
  return axServiciosDe(a).filter(s => s.tipo !== 'api' && !axServDe(a.id, s.k)?.pagado && !axServDe(a.id, s.k)?.no_corresponde);
}

function axRenderServicios(){
  const base = axAlq.filter(a => axActiva(a) && axServiciosDe(a).length && (!axServTab || axTabDe(a) === axServTab));
  const q = axNorm(axBusqueda);
  const cuenta = f => base.filter(a => axServPasa(a, f)).length;
  const lista = base.filter(a => axServPasa(a, axServFiltro) && (!q || axNorm(`${a.unidad} ${axEdificio(a)} ${a.inquilino} ${a.propietario}`).includes(q)))
    .sort((x, y) => axNombreUnidad(x).localeCompare(axNombreUnidad(y), 'es'));
  const chip = (val, label) => `<button class="btn-sm" onclick="axServFiltro='${val}';renderAlquileres()" style="${axServFiltro === val ? 'background:var(--text);color:white;border-color:var(--text)' : ''}">${label}${val ? ` · ${cuenta(val)}` : ''}</button>`;
  const chipTab = (val, label) => `<button class="btn-sm" onclick="axServTab='${val}';renderAlquileres()" style="${axServTab === val ? 'border-color:var(--accent);color:var(--accent);font-weight:600' : ''}">${label}</button>`;
  const apiTotal = base.reduce((s, a) => s + (Number(axServDe(a.id, 'API')?.monto) || 0), 0);
  const extraTotal = base.reduce((s, a) => s + axExtraMes(a), 0);
  const th = AX_SERV.map(s => `<th style="width:${s.tipo === 'boleta' ? 88 : 130}px">${s.label}</th>`).join('');
  document.getElementById('main').innerHTML = `
    ${axHeaderHTML()}
    ${axAvisosBase()}
    ${axTabsHTML()}
    ${!axServOK ? `<div style="background:var(--red-bg);color:var(--red);border-radius:var(--radius);padding:12px 16px;margin-bottom:16px;font-size:13px">⚠ Para usar esta pestaña falta correr el script <b>sql/2026-10_servicios.sql</b> en Supabase → SQL Editor.</div>` : ''}
    <div class="stats" style="grid-template-columns:repeat(5,1fr)">
      <div class="stat-card"><div class="stat-label">Unidades con servicios</div><div class="stat-value">${base.length}</div></div>
      <div class="stat-card"><div class="stat-label">Falta enviar boleta</div><div class="stat-value">${cuenta('boleta')}</div></div>
      <div class="stat-card"><div class="stat-label">Falta comprobante</div><div class="stat-value">${cuenta('comprobante')}</div></div>
      <div class="stat-card"><div class="stat-label">Exp. extraordinarias</div><div class="stat-value" style="font-size:14px">${axPesos(extraTotal)}<div style="font-size:11px;font-weight:400;color:var(--text-2)">se descuentan del alquiler</div></div></div>
      <div class="stat-card"><div class="stat-label">API pagada por MAO</div><div class="stat-value" style="font-size:14px">${axPesos(apiTotal)}<div style="font-size:11px;font-weight:400;color:var(--text-2)">se descuenta al propietario</div></div></div>
    </div>
    <div class="toolbar" style="flex-wrap:wrap">
      <div class="search-wrap"><span class="search-icon">⌕</span><input id="ax-buscar" placeholder="Buscar unidad, inquilino, propietario..." value="${axH(axBusqueda)}" oninput="axBusqueda=this.value;renderAlquileres();const i=document.getElementById('ax-buscar');i.focus();i.setSelectionRange(i.value.length,i.value.length)"></div>
      ${chipTab('', 'Todos')}${chipTab('db', 'DB')}${chipTab('dbgb', 'DB + GB')}${chipTab('prop', 'Propietarios')}
      <span style="width:12px"></span>
      ${chip('', 'Todas')}${chip('boleta', '📤 Falta enviar boleta')}${chip('comprobante', 'Falta comprobante')}${chip('expensas', 'Falta expensas')}${chip('extra', 'Con extraordinarias')}${chip('api', 'API a pagar')}
    </div>
    <div style="font-size:11px;color:var(--text-3);margin:-4px 0 12px">📤 = le mandaste la boleta · ✓ = te mandó el comprobante (pagado) · — = no corresponde este mes. Las boletas marcadas 📤 se nombran en el WhatsApp del mes. Los servicios de cada unidad salen de los números de cuenta cargados; con ⚙ los cambiás.</div>
    <div class="table-wrap ax-scroll"><table style="table-layout:auto">
      <thead><tr><th>Unidad</th><th>Inquilino</th>${th}<th></th></tr></thead>
      <tbody>${lista.map(axRenderServFila).join('') || '<tr><td colspan="10" style="padding:30px;text-align:center;color:var(--text-3)">No hay unidades para mostrar</td></tr>'}</tbody>
    </table></div>`;
}
function axServPasa(a, f){
  const tiene = axServiciosDe(a), r = k => axServDe(a.id, k) || {};
  if(f === 'boleta') return tiene.some(s => s.tipo === 'boleta' && !r(s.k).boleta_enviada && !r(s.k).pagado && !r(s.k).no_corresponde);
  if(f === 'comprobante') return tiene.some(s => s.tipo === 'boleta' && !r(s.k).pagado && !r(s.k).no_corresponde);
  if(f === 'expensas') return tiene.some(s => s.k === 'EXPENSAS') && !r('EXPENSAS').pagado && !r('EXPENSAS').no_corresponde;
  if(f === 'extra') return axExtraMes(a) > 0;
  if(f === 'api') return tiene.some(s => s.k === 'API') && !axAPICubierta(a) && !r('API').pagado && !r('API').no_corresponde;
  return true;
}
function axRenderServFila(a){
  const tiene = axServiciosDe(a).map(s => s.k);
  const td = 'style="padding:6px;font-size:12px;vertical-align:middle;white-space:nowrap"';
  const btn = (on, label, onclick, title, color) => `<button class="btn-sm" onclick="${onclick}" title="${axH(title)}" style="padding:3px 7px;${on ? `background:${color};color:white;border-color:${color}` : ''}">${label}</button>`;
  const celdas = AX_SERV.map(s => {
    if(!tiene.includes(s.k)) return `<td ${td}><span style="color:var(--border)">·</span></td>`;
    const r = axServDe(a.id, s.k) || {}, cta = s.cuenta(a), tit = `${s.label}${cta && cta !== true ? ' · cuenta ' + cta : ''}`;
    const nc = btn(r.no_corresponde, '—', `axServToggle(${a.id},'${s.k}','no_corresponde')`, 'No corresponde este mes', '#888780');
    if(r.no_corresponde) return `<td ${td}>${nc}</td>`;
    if(s.tipo === 'boleta') return `<td ${td}><div style="display:flex;gap:3px">
      ${btn(r.boleta_enviada, '📤', `axServToggle(${a.id},'${s.k}','boleta_enviada')`, tit + ': le mandé la boleta', '#185FA5')}
      ${btn(r.pagado, '✓', `axServToggle(${a.id},'${s.k}','pagado')`, tit + ': me mandó el comprobante', '#3B6D11')}${nc}</div></td>`;
    const inp = (campo, val, ph) => `<input type="number" value="${val || ''}" placeholder="${ph}" onchange="axServMonto(${a.id},'${s.k}','${campo}',this.value)" style="width:64px;padding:4px 5px;border:1px solid var(--border);border-radius:6px;font-family:inherit;font-size:12px;background:var(--surface)">`;
    if(s.tipo === 'expensas') return `<td ${td}><div style="display:flex;gap:3px;align-items:center">
      ${btn(r.pagado, '✓', `axServToggle(${a.id},'EXPENSAS','pagado')`, 'Me mandó las expensas pagas', '#3B6D11')}
      ${inp('extraordinarias', r.extraordinarias, 'Extra $')}${nc}</div></td>`;
    if(axAPICubierta(a)) return `<td ${td}><span title="${axH(tit)}" style="color:var(--green)">✓ anual hasta ${axFmtPeriodo(a.api_pagada_hasta)}</span> <a href="#" onclick="event.preventDefault();axAPIAnual(${a.id})" title="Cambiar" style="color:var(--text-3)">✎</a></td>`;
    return `<td ${td}><div style="display:flex;gap:3px;align-items:center">
      ${btn(false, 'Anual', `axAPIAnual(${a.id})`, 'Está pagada por adelantado (ej. todo el año)', '')}
      ${btn(r.pagado, '✓', `axServToggle(${a.id},'API','pagado')`, tit + ': la pagué yo (se descuenta al propietario)', '#3B6D11')}
      ${inp('monto', r.monto, 'Monto $')}${nc}</div></td>`;
  }).join('');
  const faltan = axServFaltan(a);
  return `<tr style="cursor:default">
    <td style="padding:6px;font-size:12px;white-space:normal;min-width:150px"><b style="font-weight:500">${axH(axNombreUnidad(a))}</b> <a href="#" onclick="event.preventDefault();axEditarServicios(${a.id})" title="Elegir qué servicios tiene esta unidad" style="color:var(--text-3);text-decoration:none">⚙</a><div style="font-size:11px;color:var(--text-3)">${axH(a.propietario || '')}</div></td>
    <td style="padding:6px;font-size:12px;white-space:normal;max-width:130px">${axH(a.inquilino)}</td>${celdas}
    <td ${td}>${faltan.length ? `<button class="btn-sm" onclick="axServRecordatorio(${a.id})" title="WhatsApp recordando: ${axH(axLista(faltan.map(s => s.label)))}" style="color:#128C4A;border-color:#9ED9B5">💬 Recordar</button>` : '<span style="color:var(--green)">✓ completo</span>'}</td></tr>`;
}
async function axServGuardar(id, k, cambios){
  if(!axServOK){ showToast('Primero hay que correr el script sql/2026-10_servicios.sql'); return false; }
  const r = axServDe(id, k);
  const fila = { alquiler_id: id, periodo: axPeriodo, servicio: k, ...cambios, updated_at: new Date().toISOString() };
  const { data, error } = await db.from('servicios_mes').upsert(fila, { onConflict: 'alquiler_id,periodo,servicio' }).select().single();
  if(error){ showToast('Error: ' + error.message); return false; }
  if(r) Object.assign(r, data); else axServ.push(data);
  delete axMsgEditado[id];
  return true;
}
async function axServToggle(id, k, campo){
  const r = axServDe(id, k) || {};
  if(await axServGuardar(id, k, { [campo]: !r[campo] })) renderAlquileres();
}
async function axServMonto(id, k, campo, val){
  const n = val === '' ? null : Math.round(Number(String(val).replace(',', '.')) || 0);
  // Cargar el monto de la API implica que ya se pagó
  const extra = k === 'API' && n ? { pagado: true } : {};
  if(!(await axServGuardar(id, k, { [campo]: n, ...extra }))) return;
  // El descuento de extraordinarias cambia lo que se le cobra al inquilino
  if(k === 'EXPENSAS'){
    const a = axAlq.find(x => x.id === id), p = axPagoDe(id);
    if(a && p && ['sin_avisar','avisado'].includes(axEtapa(p))){
      const monto = axTotalMes(a);
      await db.from('pagos_mensuales').update({ monto_esperado: monto }).eq('id', p.id);
      p.monto_esperado = monto;
    }
    if(n) showToast(`Se descuentan ${axPesos(n)} del alquiler de ${axFmtPeriodo(axPeriodo)}`);
  }
  renderAlquileres();
}
async function axAPIAnual(id){
  const a = axAlq.find(x => x.id === id); if(!a) return;
  const [, y] = axPeriodo.split('-');
  const r = prompt(`API de ${axNombreUnidad(a)}: ¿hasta qué mes está pagada? (mes-año, ej. 12-${y})\nDejalo vacío para quitarlo.`, a.api_pagada_hasta || `12-${y}`);
  if(r === null) return;
  const t = r.trim().replace('/', '-');
  const m = t.match(/^(\d{1,2})-(\d{4})$/);
  if(t && !m){ showToast('Escribilo como mes-año, ej. 12-2026'); return; }
  const val = m ? `${m[1].padStart(2, '0')}-${m[2]}` : null;
  const { error } = await db.from('alquileres').update({ api_pagada_hasta: val }).eq('id', id);
  if(error){ showToast('Error: ' + error.message); return; }
  a.api_pagada_hasta = val;
  showToast(val ? `API pagada hasta ${axFmtPeriodo(val)} ✓` : 'API anual quitada');
  renderAlquileres();
}
function axServRecordatorio(id){
  const a = axAlq.find(x => x.id === id); if(!a) return;
  const tel = axTelGrupo(a);
  if(!tel){ showToast('Falta el teléfono del inquilino'); return; }
  const faltan = axServFaltan(a).map(s => s.k === 'EXPENSAS' ? 'las expensas' : s.label);
  const msg = `Hola ${(a.inquilino || '').trim()}, buen día! ¿Cómo estás?\nTe recuerdo que me falta el comprobante de pago de ${axLista(faltan)} de ${axFmtPeriodo(axPeriodo)} (${axNombreUnidad(a)}). Cuando puedas me lo mandás. ¡Gracias!`;
  window.open(`https://wa.me/${tel}?text=${encodeURIComponent(msg)}`, '_blank');
}
function axEditarServicios(id){
  const a = axAlq.find(x => x.id === id); if(!a) return;
  const tiene = axServiciosDe(a).map(s => s.k);
  document.getElementById('ax-modal')?.remove();
  const m = document.createElement('div');
  m.id = 'ax-modal';
  m.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;z-index:9999;padding:20px';
  m.innerHTML = `<div style="background:var(--surface);border-radius:var(--radius);width:100%;max-width:400px;padding:20px 22px">
    <div style="font-family:'DM Serif Display',serif;font-size:18px;margin-bottom:4px">Servicios · ${axH(axNombreUnidad(a))}</div>
    <div style="font-size:12px;color:var(--text-3);margin-bottom:12px">Marcá los impuestos y servicios que se controlan en esta unidad.</div>
    ${AX_SERV.map(s => `<label style="display:flex;gap:8px;align-items:center;font-size:13px;padding:5px 0"><input type="checkbox" class="ax-serv-chk" value="${s.k}" ${tiene.includes(s.k) ? 'checked' : ''}> ${s.label}${s.cuenta(a) && s.cuenta(a) !== true ? ` <span style="font-size:11px;color:var(--text-3)">cuenta ${axH(s.cuenta(a))}</span>` : ''}</label>`).join('')}
    <div style="display:flex;gap:8px;margin-top:14px">
      <button class="btn-sm" style="flex:1;padding:9px" onclick="document.getElementById('ax-modal').remove()">Cancelar</button>
      <button class="btn-primary" style="flex:1" onclick="axGuardarServicios(${a.id})">Guardar</button>
    </div></div>`;
  document.body.appendChild(m);
}
async function axGuardarServicios(id){
  const val = [...document.querySelectorAll('.ax-serv-chk:checked')].map(x => x.value).join(',');
  const { error } = await db.from('alquileres').update({ servicios: val }).eq('id', id);
  if(error){ showToast('Error: ' + error.message); return; }
  const a = axAlq.find(x => x.id === id); if(a) a.servicios = val;
  document.getElementById('ax-modal')?.remove();
  showToast('Servicios guardados ✓');
  renderAlquileres();
}

// ---------- acciones ----------
function axCambiarMes(delta){
  const [m, y] = axPeriodo.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  axPeriodo = `${String(d.getMonth()+1).padStart(2,'0')}-${d.getFullYear()}`;
  axOpen = null; axICL = null;
  Object.keys(axMsgEditado).forEach(k => delete axMsgEditado[k]);
  loadAlquileres();
}

function axToggle(id){
  axOpen = axOpen === id ? null : id;
  renderAlquileres();
  document.getElementById(`ax-row-${id}`)?.focus({ preventScroll: true });
}

async function axAsegurarPago(a){
  let p = axPagoDe(a.id);
  if(p) return p;
  const { data, error } = await db.from('pagos_mensuales').insert({
    alquiler_id: a.id, periodo: axPeriodo, etapa: 'sin_avisar', estado: 'pendiente',
    monto_esperado: axTotalMes(a), moneda: axEsUSD(a) ? 'USD' : 'ARS',
  }).select().single();
  if(error){ showToast('Error: ' + error.message); return null; }
  axPagos.push(data);
  return data;
}

async function axSetEtapa(id, etapa, desdeSelector, enGrupo){
  if(!axSchemaOK){ showToast('Primero hay que correr el script SQL'); return; }
  const a = axAlq.find(x => x.id === id); if(!a) return;
  const orden = ['sin_avisar','avisado','parcial','pagado','rendido'];
  if(!desdeSelector && axPagoDe(id) && orden.indexOf(etapa) <= orden.indexOf(axEtapa(axPagoDe(id)))) return;
  if(etapa === 'avisado' && !desdeSelector && !enGrupo){
    const otras = axGrupoInquilino(a).slice(1).filter(x => axEtapa(axPagoDe(x.id)) === 'sin_avisar');
    const msgGrupo = document.getElementById(`ax-msg-${id}`)?.value || axMsgEditado[id] || axMensaje(a);
    for(const x of otras){ axMsgEditado[x.id] = msgGrupo; await axSetEtapa(x.id, 'avisado', false, true); }
  }
  const p = await axAsegurarPago(a); if(!p) return;
  const ahora = new Date().toISOString();
  const c = axCalculoMes(a);
  const upd = { etapa };
  if(etapa === 'sin_avisar'){
    Object.assign(upd, { avisado_at: null, pagado_at: null, rendido_at: null, monto_cobrado: null });
    if(p.estado === 'pagado' || p.estado === 'pago-pendiente') upd.estado = 'pendiente';
  }
  if(etapa === 'avisado'){
    Object.assign(upd, { avisado_at: ahora, fecha_envio: ahora, monto_esperado: axTotalMes(a),
      mensaje_wa: document.getElementById(`ax-msg-${id}`)?.value || axMsgEditado[id] || axMensaje(a) });
    if(!p.estado || p.estado === 'pendiente') upd.estado = 'pago-pendiente';
    if(desdeSelector) Object.assign(upd, { pagado_at: null, rendido_at: null, estado: 'pago-pendiente', monto_cobrado: null });
  }
  if(etapa === 'pagado'){
    Object.assign(upd, { pagado_at: ahora, estado: 'pagado', fecha_pago: p.fecha_pago || axISO(new Date()),
      monto_cobrado: Math.max(Number(p.monto_cobrado) || 0, axTotalMes(a)), monto_esperado: axTotalMes(a) });
    if(desdeSelector) upd.rendido_at = null;
  }
  if(etapa === 'rendido') Object.assign(upd, { rendido_at: ahora });
  const { error } = await db.from('pagos_mensuales').update(upd).eq('id', p.id);
  if(error){ showToast('Error: ' + error.message); return; }
  Object.assign(p, upd);
  if(enGrupo) return;
  showToast(`${axNombreUnidad(a)} → ${AX_ETAPAS[etapa].label}`);
  renderAlquileres();
  document.getElementById(`ax-row-${id}`)?.focus({ preventScroll: true });
}

function axWhatsApp(id){
  const a = axAlq.find(x => x.id === id); if(!a) return;
  const tel = axTelGrupo(a);
  if(!tel){
    axOpen = id; renderAlquileres();
    const inp = document.getElementById(`ax-tel-${id}`); if(inp){ inp.focus(); inp.scrollIntoView({ block: 'center' }); }
    showToast('Falta el teléfono del inquilino: cargalo y guardá');
    return;
  }
  const msg = document.getElementById(`ax-msg-${id}`)?.value ?? axMsgEditado[id] ?? axMensaje(a);
  window.open(`https://wa.me/${tel}?text=${encodeURIComponent(msg)}`, '_blank');
}

function axCopiarMsg(id){
  const a = axAlq.find(x => x.id === id); if(!a) return;
  const msg = document.getElementById(`ax-msg-${id}`)?.value ?? axMensaje(a);
  navigator.clipboard.writeText(msg).then(() => showToast('Mensaje copiado')).catch(() => prompt('Copiá el mensaje:', msg));
}

async function axGuardarTel(id){
  const val = document.getElementById(`ax-tel-${id}`)?.value.trim() || '';
  const { error } = await db.from('alquileres').update({ tel_inquilino: val }).eq('id', id);
  if(error){ showToast('Error: ' + error.message); return; }
  const a = axAlq.find(x => x.id === id); if(a) a.tel_inquilino = val;
  showToast(axWAPhone(val) ? 'Teléfono guardado ✓' : 'Guardado, pero el número no parece válido para WhatsApp');
  renderAlquileres();
}

async function axEditarDatosPago(propId){
  const p = axProps.find(x => x.id === propId); if(!p) return;
  document.getElementById('ax-modal')?.remove();
  const m = document.createElement('div');
  m.id = 'ax-modal';
  m.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;z-index:9999;padding:20px';
  m.innerHTML = `<div style="background:var(--surface);border-radius:var(--radius);width:100%;max-width:460px;padding:20px 22px">
    <div style="font-family:'DM Serif Display',serif;font-size:18px;margin-bottom:4px">Datos de pago · ${axH(p.nombre)}</div>
    <div style="font-size:12px;color:var(--text-3);margin-bottom:12px">Este texto va al final de cada WhatsApp de las unidades de este propietario. Si lo dejás vacío se usan los datos bancarios cargados${axNorm(p.nombre).startsWith('DB') ? '' : ' y la cuenta de MAO para honorarios'}.</div>
    <textarea id="ax-datos-pago" style="width:100%;min-height:140px;padding:10px;border:1px solid var(--border);border-radius:8px;font-family:inherit;font-size:13px;box-sizing:border-box" placeholder="Ej:&#10;Transferir a: ...&#10;CBU: ...&#10;Alias: ...">${axH(p.datos_pago_wa || '')}</textarea>
    <div style="display:flex;gap:8px;margin-top:12px">
      <button class="btn-sm" style="flex:1;padding:9px" onclick="document.getElementById('ax-modal').remove()">Cancelar</button>
      <button class="btn-primary" style="flex:1" onclick="axGuardarDatosPago(${p.id})">Guardar</button>
    </div></div>`;
  document.body.appendChild(m);
}
async function axGuardarDatosPago(propId){
  const val = document.getElementById('ax-datos-pago')?.value.trim() || null;
  const { error } = await db.from('propietarios').update({ datos_pago_wa: val }).eq('id', propId);
  if(error){ showToast('Error: ' + error.message); return; }
  const p = axProps.find(x => x.id === propId); if(p) p.datos_pago_wa = val;
  document.getElementById('ax-modal')?.remove();
  Object.keys(axMsgEditado).forEach(k => delete axMsgEditado[k]);
  showToast('Datos de pago guardados ✓');
  renderAlquileres();
}

async function axConfirmarICL(ids){
  if(!axSchemaOK){ showToast('Primero hay que correr el script SQL'); return; }
  const calc = ids.map(id => { const a = axAlq.find(x => x.id === id); return { a, c: a && axCalculoICL(a) }; })
                  .filter(x => x.a && x.c && !x.c.confirmado && !x.c.error);
  if(calc.length === 0) return;
  const prov = calc.filter(x => x.c.provisorio);
  let txt = calc.map(x => `• ${axNombreUnidad(x.a)}: ${axPesos(x.c.anterior)} → ${axPesos(x.c.nuevo)} (coef. ${x.c.coef.toFixed(4)})`).join('\n');
  if(prov.length) txt += `\n\n⚠ ${prov.length} con ICL provisorio (el del día del aumento todavía no está publicado).`;
  if(!confirm(`¿Aplicar ${calc.length} aumento${calc.length !== 1 ? 's' : ''}?\n\n${txt}`)) return;
  let ok = 0;
  for(const { a, c } of calc){
    const registro = {
      alquiler_id: a.id, periodo: axPeriodo,
      fecha_base: axISO(c.pasos[c.pasos.length - 2].fecha), fecha_ajuste: axISO(c.au.fechaAjuste),
      icl_fecha_base: c.ini.fecha, icl_fecha_ajuste: c.fin.fecha,
      icl_inicial: c.ini.valor, icl_final: c.fin.valor, coeficiente: Number(c.coef.toFixed(6)),
      importe_anterior: c.anterior, importe_nuevo: c.nuevo, provisorio: c.provisorio,
    };
    const { data: aj, error: e1 } = await db.from('ajustes_icl').upsert(registro, { onConflict: 'alquiler_id,periodo' }).select().single();
    if(e1){ showToast('Error: ' + e1.message); continue; }
    const pct = Number(a.comision_pct);
    const upd = { alq_anterior: c.anterior, alq_actual: c.nuevo, fecha_ultimo_ajuste: axISO(c.au.fechaAjuste),
                  ...(pct > 0 && pct < 1 ? { [axCampoComision(a)]: Math.round(c.nuevo * pct) } : {}) };
    const { error: e2 } = await db.from('alquileres').update(upd).eq('id', a.id);
    if(e2){ showToast('Error: ' + e2.message); continue; }
    Object.assign(a, upd);
    axAjustes = axAjustes.filter(x => !(x.alquiler_id === a.id && x.periodo === axPeriodo)).concat(aj);
    const p = axPagoDe(a.id);
    if(p && axEtapa(p) === 'sin_avisar'){
      const monto = axTotalMes(a);
      await db.from('pagos_mensuales').update({ monto_esperado: monto }).eq('id', p.id);
      p.monto_esperado = monto;
    }
    delete axMsgEditado[a.id];
    ok++;
  }
  showToast(`${ok} aumento${ok !== 1 ? 's' : ''} aplicado${ok !== 1 ? 's' : ''} ✓`);
  renderAlquileres();
}

async function axDeshacerICL(id){
  const a = axAlq.find(x => x.id === id), aj = axAjusteDe(id);
  if(!a || !aj) return;
  if(!confirm(`¿Deshacer el aumento de ${axNombreUnidad(a)}?\nEl alquiler vuelve a ${axPesos(aj.importe_anterior)}.`)) return;
  const pct = Number(a.comision_pct);
  const upd = { alq_actual: Number(aj.importe_anterior), ...(pct > 0 && pct < 1 ? { [axCampoComision(a)]: Math.round(aj.importe_anterior * pct) } : {}) };
  const { error } = await db.from('alquileres').update(upd).eq('id', id);
  if(error){ showToast('Error: ' + error.message); return; }
  await db.from('ajustes_icl').delete().eq('id', aj.id);
  Object.assign(a, upd);
  axAjustes = axAjustes.filter(x => x.id !== aj.id);
  delete axMsgEditado[id];
  showToast('Aumento deshecho');
  renderAlquileres();
}

// ---------- editar datos de la unidad ----------
const AX_EDIT = [
  ['propietario', 'Propietario', 'text'], ['inquilino', 'Inquilino', 'text'], ['email_inquilino', 'Email inquilino', 'text'],
  ['cobra', 'Cobra', 'text'], ['inicio_contrato', 'Inicio contrato', 'date'], ['fin_contrato', 'Fin contrato', 'date'],
  ['tipo_contrato', 'Tipo de contrato', ['TRIMESTRAL','CUATRIMESTRAL','SEMESTRAL','FIJO','SIN CONTRATO']],
  ['ajuste', 'Índice de ajuste', ['ICL','IPC']], ['mes_aumento', 'Mes aumento (texto)', 'text'], ['fecha_ultimo_ajuste', 'Último aumento aplicado', 'date'],
  ['moneda', 'Moneda', ['ARS','USD']], ['iva_pct', 'IVA (se suma al alquiler)', ['21%','10,5%']], ['alq_inicial', 'Alquiler inicial', 'number'], ['alq_actual', 'Alquiler actual ($)', 'number'],
  ['alq_actual_usd', 'Alquiler actual (USD)', 'number'], ['comision_pct', 'Comisión MAO (%)', 'number'],
  ['interes_mensual', 'Interés por mora (% por mes)', 'number'],
];
function axFechaParaInput(v){ return axISO(axParseFecha(v)) || ''; }
// Guarda la fecha con el mismo formato que ya usa la base (DD/MM/AAAA o AAAA-MM-DD)
function axFechaParaBase(iso, campo){
  if(!iso) return null;
  if(campo === 'fecha_ultimo_ajuste') return iso;
  const usaBarra = axAlq.some(x => String(x[campo] || '').includes('/'));
  if(!usaBarra) return iso;
  const [y, m, d] = iso.split('-'); return `${d}/${m}/${y}`;
}
function axEditarUnidad(id){
  const a = axAlq.find(x => x.id === id); if(!a) return;
  document.getElementById('ax-modal')?.remove();
  const campo = ([k, label, tipo]) => {
    let v = a[k] ?? '';
    if((k === 'comision_pct' || k === 'interes_mensual') && v !== '') v = Math.round(Number(v) * 10000) / 100;
    if(tipo === 'date') v = axFechaParaInput(v);
    if(k === 'tipo_contrato') v = axTipoContrato(a);
    if(k === 'moneda') v = axEsUSD(a) ? 'USD' : 'ARS';
    if(k === 'iva_pct') v = Number(a.iva_pct) === 0.21 ? '21%' : Number(a.iva_pct) === 0.105 ? '10,5%' : '';
    const inp = Array.isArray(tipo)
      ? `<select id="ax-e-${k}" style="width:100%;padding:6px 8px;border:1px solid var(--border);border-radius:6px;font-family:inherit;font-size:13px"><option value=""></option>${tipo.map(o => `<option ${o === v ? 'selected' : ''}>${o}</option>`).join('')}</select>`
      : `<input id="ax-e-${k}" type="${tipo}" value="${axH(v)}" style="width:100%;padding:6px 8px;border:1px solid var(--border);border-radius:6px;font-family:inherit;font-size:13px;box-sizing:border-box">`;
    return `<label style="font-size:11px;color:var(--text-3)">${label}${inp}</label>`;
  };
  const m = document.createElement('div');
  m.id = 'ax-modal';
  m.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;z-index:9999;padding:20px';
  m.innerHTML = `<div style="background:var(--surface);border-radius:var(--radius);width:100%;max-width:620px;padding:20px 22px;max-height:90vh;overflow:auto">
    <div style="font-family:'DM Serif Display',serif;font-size:18px;margin-bottom:12px">Editar · ${axH(axNombreUnidad(a))}</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">${AX_EDIT.map(campo).join('')}</div>
    <div style="display:flex;gap:8px;margin-top:16px">
      <button class="btn-sm" style="flex:1;padding:9px" onclick="document.getElementById('ax-modal').remove()">Cancelar</button>
      <button class="btn-primary" style="flex:1" onclick="axGuardarUnidad(${a.id})">Guardar</button>
    </div></div>`;
  document.body.appendChild(m);
}
async function axGuardarUnidad(id){
  const a = axAlq.find(x => x.id === id); if(!a) return;
  const upd = {};
  AX_EDIT.forEach(([k, , tipo]) => {
    let v = document.getElementById(`ax-e-${k}`)?.value.trim() ?? '';
    if(tipo === 'number') v = v === '' ? null : Number(v.replace(',', '.'));
    else if(tipo === 'date') v = axFechaParaBase(v, k);
    else v = v === '' ? null : v;
    if((k === 'comision_pct' || k === 'interes_mensual') && v !== null) v = v / 100;
    if(k === 'iva_pct') v = v === '21%' ? 0.21 : v === '10,5%' ? 0.105 : null;
    const antes = a[k] ?? null;
    if(String(antes ?? '') !== String(v ?? '')) upd[k] = v;
  });
  if(upd.tipo_contrato !== undefined) upd.periodicidad_meses = { TRIMESTRAL: 3, CUATRIMESTRAL: 4, SEMESTRAL: 6 }[upd.tipo_contrato] || null;
  if(upd.comision_pct !== undefined || upd.alq_actual !== undefined){
    const pct = upd.comision_pct ?? a.comision_pct, alq = upd.alq_actual ?? a.alq_actual;
    upd[axCampoComision(a)] = pct > 0 && pct < 1 ? Math.round(alq * pct) : null;
  }
  if(Object.keys(upd).length === 0){ document.getElementById('ax-modal')?.remove(); return; }
  const { error } = await db.from('alquileres').update(upd).eq('id', id);
  if(error){ showToast('Error: ' + error.message); return; }
  Object.assign(a, upd);
  document.getElementById('ax-modal')?.remove();
  delete axMsgEditado[id];
  showToast('Datos guardados ✓');
  renderAlquileres();
}

// Atajos de teclado (solo en esta vista y fuera de los campos de texto)
document.addEventListener('keydown', ev => {
  if(currentView !== 'alquileres2') return;
  if(['INPUT','TEXTAREA','SELECT'].includes(ev.target.tagName) || ev.metaKey || ev.ctrlKey || ev.altKey) return;
  if(document.getElementById('ax-modal') || document.getElementById('ax-import')) return;
  const filas = [...document.querySelectorAll('tr[data-ax]')];
  if(filas.length === 0) return;
  const actual = document.activeElement?.closest?.('tr[data-ax]');
  let i = actual ? filas.indexOf(actual) : -1;
  const id = actual ? Number(actual.dataset.ax) : null;
  if(ev.key === 'ArrowDown' || ev.key === 'ArrowUp'){
    ev.preventDefault();
    i = ev.key === 'ArrowDown' ? Math.min(filas.length - 1, i + 1) : Math.max(0, i - 1);
    filas[i].focus(); filas[i].scrollIntoView({ block: 'nearest' });
  } else if(id && ev.key === 'Enter'){ ev.preventDefault(); axToggle(id); }
  else if(id && (ev.key === 'w' || ev.key === 'W')){ axWhatsApp(id); }
  else if(id && (ev.key === 'a' || ev.key === 'A')){ axSetEtapa(id, 'avisado'); }
  else if(id && (ev.key === 'p' || ev.key === 'P')){ axPagado(id); }
});
