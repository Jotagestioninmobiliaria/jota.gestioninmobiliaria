// =============================================
// IMPORTAR EXCEL DE ALQUILERES (una hoja por mes)
// 1) Lee el Excel en el navegador  2) Lo compara con la base
// 3) Muestra resumen y cambios      4) Aplica SOLO lo que se tilda. Nunca borra.
// =============================================

let axImp = null; // { filas, matches, nuevosProps, formatoFecha }

// Columnas del Excel (fila 1 = encabezados). "Monto a reponer" y "A reponer a" se ignoran.
const AX_COLS = {
  edificio: 'A', tipo_unidad: 'B', unidad: 'C', propietario: 'D', inquilino: 'E', cobra: 'F',
  inicio: 'G', fin: 'H', tipo_contrato: 'I', mes_aumento: 'J', alq_inicial: 'K', alq_actual: 'L', alq_usd: 'M',
  comision_pct: 'Q', comision_r: 'R', comision_s: 'S', expensas: 'T', tel_inquilino: 'U', email_inquilino: 'V',
  adm_email: 'W', adm_telefono: 'X', seguro: 'Y', tgi_cuenta: 'Z', tgi_gestion: 'AA', api: 'AB', aguas: 'AC',
  gas_cliente: 'AD', gas_persona: 'AE', epe_cliente: 'AF', epe_plan: 'AG',
};

// Excel → columna de la base. Las fechas se escriben con el mismo formato que ya usa la base.
const AX_CAMPOS = [
  ['propietario','propietario'], ['inquilino','inquilino'], ['cobra','cobra'], ['edificio','edificio'], ['tipo_unidad','tipo'],
  ['inicio','inicio_contrato'], ['fin','fin_contrato'], ['tipo_contrato','tipo_contrato'], ['periodicidad','periodicidad_meses'],
  ['mes_aumento','mes_aumento'], ['alq_inicial','alq_inicial'], ['alq_actual','alq_actual'], ['alq_usd','alq_actual_usd'], ['moneda','moneda'],
  ['comision_pct','comision_pct'], ['comision_r','comision_db'], ['comision_s','comision_adm'], ['expensas','expensas_monto'],
  ['tel_inquilino','tel_inquilino'], ['email_inquilino','email_inquilino'], ['adm_email','adm_contacto'], ['adm_telefono','tel_adm'],
  ['seguro','seguro'], ['tgi_cuenta','tgi_cuenta'], ['tgi_gestion','tgi_gestion'], ['api','api'], ['aguas','aguas'],
  ['gas_cliente','gas_cliente'], ['gas_persona','gas_persona'], ['epe_cliente','epe_cliente'], ['epe_plan','epe_plan'],
  ['ultimo_ajuste','fecha_ultimo_ajuste'],
];
const AX_NUMERICOS = new Set(['alq_inicial','alq_actual','alq_actual_usd','comision_pct','comision_adm','comision_db','expensas_monto','periodicidad_meses']);

function axCelda(v){
  if(v === null || v === undefined) return null;
  if(v instanceof Date) return axISO(new Date(v.getFullYear(), v.getMonth(), v.getDate()));
  if(typeof v === 'number' && Number.isInteger(v)) v = String(v);
  let s = String(v).trim();
  if(s === '' || s === '-' || s.toUpperCase() === 'N/A') return null;
  if(/^\.\d/.test(s)) s = s.slice(1); // Excel: "." adelante para forzar texto
  return s;
}
function axNum(v){
  const s = axCelda(v);
  if(s === null) return null;
  const n = Number(s.replace(',', '.'));
  return isNaN(n) ? null : Math.round(n * 100) / 100;
}

function axLeerHoja(ws){
  const get = (col, r) => { const c = ws[`${col}${r}`]; return c ? c.v : null; };
  // Fechas: se leen como número de serie de Excel para evitar corrimientos por zona horaria
  const fecha = (col, r) => {
    const v = get(col, r);
    if(typeof v !== 'number') return axCelda(v);
    const d = XLSX.SSF.parse_date_code(v);
    return d ? `${d.y}-${String(d.m).padStart(2,'0')}-${String(d.d).padStart(2,'0')}` : null;
  };
  const h = k => axNorm(get(AX_COLS[k], 1));
  if(!h('edificio').startsWith('EDIFICIO') || !h('unidad').startsWith('UNIDAD') || !h('alq_actual').startsWith('ALQUILER ACTUAL')){
    throw new Error('El Excel no tiene las columnas esperadas (Edificio, Tipo, Unidad / propiedad, … Alquiler actual)');
  }
  const filas = [];
  let ignoradas = 0, fin = false;
  const ultima = XLSX.utils.decode_range(ws['!ref']).e.r + 1;
  for(let r = 2; r <= ultima; r++){
    const g = k => get(AX_COLS[k], r);
    const vacia = ['edificio','tipo_unidad','unidad','propietario','inquilino'].every(k => axCelda(g(k)) === null);
    // La tabla termina en la primera fila sin edificio/unidad/propietario/inquilino (fila de totales).
    // Todo lo que sigue (comisiones, pendientes, gastos, transferencias) es interno y se ignora.
    if(vacia){ if(filas.length) fin = true; continue; }
    if(fin){ ignoradas++; continue; }
    const tc = (axNorm(axCelda(g('tipo_contrato'))) || '').replace('CUATRIMENTRAL','CUATRIMESTRAL').replace('SEMESTAL','SEMESTRAL') || null;
    const alq = axNum(g('alq_actual')), usd = axNum(g('alq_usd'));
    const pct = axNum(g('comision_pct'));
    filas.push({
      fila: r,
      edificio: axNorm(axCelda(g('edificio'))).replace('ITUZANGO','ITUZAINGO') || null,
      tipo_unidad: axCelda(g('tipo_unidad')), unidad: axCelda(g('unidad')),
      propietario: axCelda(g('propietario')), inquilino: axCelda(g('inquilino')), cobra: axCelda(g('cobra')),
      inicio: fecha(AX_COLS.inicio, r), fin: fecha(AX_COLS.fin, r),
      tipo_contrato: tc, periodicidad: { TRIMESTRAL: 3, CUATRIMESTRAL: 4, SEMESTRAL: 6 }[tc] || null,
      mes_aumento: axCelda(g('mes_aumento')),
      alq_inicial: axNum(g('alq_inicial')), alq_actual: alq, alq_usd: usd,
      moneda: (usd > 0 && !(alq > 0)) ? 'USD' : 'ARS',
      comision_pct: pct !== null && pct > 0 && pct < 1 ? pct : null,
      comision_r: axNum(g('comision_r')), comision_s: axNum(g('comision_s')),
      expensas: axNum(g('expensas')),
      tel_inquilino: axCelda(g('tel_inquilino')), email_inquilino: axCelda(g('email_inquilino')),
      adm_email: axCelda(g('adm_email')), adm_telefono: axCelda(g('adm_telefono')), seguro: axCelda(g('seguro')),
      tgi_cuenta: axCelda(g('tgi_cuenta')), tgi_gestion: axCelda(g('tgi_gestion')), api: axCelda(g('api')), aguas: axCelda(g('aguas')),
      gas_cliente: axCelda(g('gas_cliente')), gas_persona: axCelda(g('gas_persona')), epe_cliente: axCelda(g('epe_cliente')), epe_plan: axCelda(g('epe_plan')),
    });
  }
  axAplicarCorrecciones(filas);
  return { filas, ignoradas };
}

// Correcciones que indicó Juliana sobre el Excel de octubre 2026 (se muestran en el resumen).
// Se buscan por edificio + unidad; si el Excel ya trae el dato corregido no cambian nada.
const AX_CORRECCIONES = [
  { edificio: 'SANTA FE 2833', unidad: '1-A + EE04', nota: 'Contrato renovado: 16/09/2026 al 15/09/2028, $650.000 inicial y actual',
    set: { inicio: '2026-09-16', fin: '2028-09-15', alq_inicial: 650000, alq_actual: 650000 } },
  { edificio: 'ITALIA 1275', unidad: '5-D', nota: 'Trimestral (julio, octubre, enero, abril). Paga hoy $503.783 (con el aumento de julio); el de octubre va en noviembre con diferencia',
    set: { tipo_contrato: 'TRIMESTRAL', periodicidad: 3, mes_aumento: 'JULIO-OCTUBRE-ENERO-ABRIL', alq_inicial: 450000, alq_actual: 503783 } },
  { edificio: 'BALCARCE 45 BIS', unidad: 'EE 01', nota: 'Juan Baleares: es la "EE 02" de la base (la base está bien)', base: 'BALCARCE 45 BIS EE 02' },
  { edificio: 'BALCARCE 45 BIS', unidad: 'EE 02', nota: 'Ana María Fleidman: es la "EE 10" de la base (la base está bien)', base: 'BALCARCE 45 BIS EE 10' },
  { edificio: 'ITUZAINGO 654', unidad: 'SS BAULERA9', nota: 'Pagliero alquila la Baulera 9: en la base estaba cargada como "Baulera 10", se corrige el nombre',
    base: 'ITUZAINGO 654 -SS BAULERA 10', renombrar: 'ITUZAINGO 654 -SS BAULERA 9' },
  { edificio: 'ITUZAINGO 654', unidad: '2-1', nota: 'Contrato renovado con el mismo inquilino: 09/08/2026 al 08/08/2028',
    set: { inicio: '2026-08-09', fin: '2028-08-08', alq_inicial: 533533 } },
  { edificio: 'BELGRANO 766', unidad: 'P6', nota: 'Contrato nuevo del 10/09/2026 al 09/09/2028: $1.050.000 inicial y actual', set: { inicio: '2026-09-10', fin: '2028-09-09', alq_actual: 1050000 } },
  { edificio: 'BALCARCE 45 BIS', unidad: '4-A', nota: 'Paga $466.157 (contrato de 1 año: 19/02/2026 al 18/02/2027)', set: { alq_actual: 466157 } },
  { edificio: 'PARAGUAY 339', unidad: '2-D', nota: 'Paga $308.097 (aumento del 14/09/2026 según ICL)', set: { alq_actual: 308097 } },
  { edificio: 'SAN LUIS 624', unidad: '5-2', nota: 'Paga $672.727 (aumento del 25/06/2026); el del 25/10 va en noviembre con diferencia', set: { alq_actual: 672727 } },
  { edificio: 'SALTA', unidad: '11', nota: 'Paga $570,038'.replace(/,/g, '.') + ' (el Excel estaba atrasado)', set: { alq_actual: 570038 } },
  { edificio: 'SANTA FE 2833', unidad: '12-A', nota: 'Paga $511,221'.replace(/,/g, '.') + ' (el Excel estaba atrasado)', set: { alq_actual: 511221 } },
  { edificio: 'ENTRE RIOS 637', unidad: '9 B', nota: 'Paga $516,061'.replace(/,/g, '.') + ' (el Excel estaba atrasado)', set: { alq_actual: 516061 } },
  { edificio: 'SANTA FE 2833', unidad: '9-A', nota: 'Paga $871,977'.replace(/,/g, '.') + ' (el Excel estaba atrasado)', set: { alq_actual: 871977 } },
  { edificio: 'PJE SANTA CRUZ', unidad: 'PJE SANTA CRUZ', nota: 'Paga $466,118'.replace(/,/g, '.') + ' (el Excel estaba atrasado)', set: { alq_actual: 466118 } },
  { edificio: 'BALCARCE 45 BIS', unidad: 'BALCARCE 45 BIS', nota: 'Paga $4,355,637'.replace(/,/g, '.') + ' (el Excel estaba atrasado)', set: { alq_actual: 4355637 } },
  { edificio: 'ENTRE RIOS 637', unidad: '2-C', nota: 'Paga $499,854'.replace(/,/g, '.') + ' (el Excel estaba atrasado)', set: { alq_actual: 499854 } },
  { edificio: 'ITUZAINGO 654', unidad: '3-1', nota: 'Paga $615.776', set: { alq_actual: 615776 } },
  { edificio: 'ITUZAINGO 654', unidad: '7-3', nota: 'Inquilina nueva Carla Maggi desde el 16/10/2026 (vence 15/10/2028), trimestral ICL, inicial $1.550.000',
    set: { inquilino: 'Carla Maggi', tel_inquilino: null, email_inquilino: null, inicio: '2026-10-16', fin: '2028-10-15', tipo_contrato: 'TRIMESTRAL', periodicidad: 3,
           mes_aumento: 'ENERO-ABRIL-JULIO-OCTUBRE', alq_inicial: 1550000, alq_actual: 1550000 } },
  { edificio: 'ITUZAINGO 654', unidad: 'AUDITORIO + EE 03', nota: 'Paga $2.546.841,88', set: { alq_actual: 2546841.88 } },
  { edificio: 'ITUZAINGO 654', unidad: 'SS BICICLETERO 1', nota: 'Desocupado: Mariano Echeverría lo alquiló hasta septiembre 2026', set: { inquilino: null, cobra: null, alq_actual: 0 }, vaciar: true },
  { edificio: 'BALCARCE 45 BIS', unidad: '2-A', nota: 'Extensión de contrato hasta el 31/10/2026 a $570.000 (precio acordado con el dueño)', set: { fin: '2026-10-31', alq_actual: 570000 } },
  { edificio: 'ITUZAINGO 654', unidad: '7-1 + EE 29', nota: 'Propietario DB+GB', set: { propietario: 'DB+GB' } },
  { edificio: 'ITUZAINGO 654', unidad: 'SS EE M3', nota: 'Desocupada: se quita el inquilino (Vaccaro Lumina)', vaciar: true },
  { edificio: '9 DE JULIO 2233', unidad: '2', nota: 'Desocupada: se quita el inquilino (Joaquín Fernández)', vaciar: true },
  { edificio: 'JUJUY 1515', unidad: 'EE M 3', nota: 'Desocupada: se quita el inquilino (Ricardo)', vaciar: true },
  { edificio: 'MENDOZA 2267', unidad: 'MENDOZA 2267', nota: 'Alquiler en USD 3.500 (se saca el "$3.500" en pesos)', vaciar: true },
  { edificio: 'ITUZAINGO 654', unidad: '03-03', nota: 'Nombre del inquilino: Grapsas Irini', set: { inquilino: 'Grapsas Irini' } },
  { edificio: 'ITUZAINGO 654', unidad: 'PB EE 58', nota: 'Nombre del inquilino: Nicolás Mariano Bottura', set: { inquilino: 'Nicolás Mariano Bottura' } },
  { edificio: 'ITUZAINGO 654', unidad: 'SS EE 27', nota: 'Nombre del inquilino: Silvina Serra', set: { inquilino: 'Silvina Serra' } },
  { edificio: 'ITUZAINGO 654', unidad: 'PB EE 66', nota: 'Nombre del inquilino unificado: Maximiliano Zarini', set: { inquilino: 'Maximiliano Zarini' } },
  { edificio: 'ITUZAINGO 654', unidad: 'PB BICILETERO 4', nota: 'Desocupado: Maximiliano Zarini ya no lo alquila', set: { inquilino: null, cobra: null, alq_actual: 0 }, vaciar: true },
  { edificio: 'ITUZAINGO 654', unidad: 'PB BICILETERO 5', nota: 'Desocupado: Maximiliano Zarini ya no lo alquila', set: { inquilino: null, cobra: null, alq_actual: 0 }, vaciar: true },
  { edificio: 'AMENABAR 1941', unidad: null, nota: 'En venta: no se importa', omitir: true },
  { edificio: 'FIHSERTON GOLF', unidad: 'EE 1', nota: 'Incluida en el alquiler del U2 P1-A', padre: 'U2 P1-A' },
  { edificio: 'FIHSERTON GOLF', unidad: 'EE 2', nota: 'Incluida en el alquiler del U2 P1-A', padre: 'U2 P1-A' },
  { edificio: 'SANTA FE 2833', unidad: 'EE 04', nota: 'Incluida en el alquiler del 1-A', padre: '1-A + EE04' },
];
// Unidades de la base que salen del listado (no se borran: quedan con activo = false)
const AX_BAJAS = [
  { unidad: 'RICHIERI 402 4-2', nota: 'Ya no la administran' },
  { unidad: 'AMENABAR 1941', nota: 'En venta' },
  { unidad: 'ITUZAINGO 654 -PB EE M8', nota: 'No existe en el Excel (motos PB van de M1 a M7)' },
  { unidad: 'ITUZAINGO 654 -PB EE M9', nota: 'No existe en el Excel (motos PB van de M1 a M7)' },
  { unidad: 'ITUZAINGO 654 -PB EE M10', nota: 'No existe en el Excel (motos PB van de M1 a M7)' },
  { unidad: 'ITUZAINGO 654 -PB EE M11', nota: 'No existe en el Excel (motos PB van de M1 a M7)' },
];
function axBajas(alqs){
  return AX_BAJAS.map(b => ({ ...b, a: alqs.find(a => axCompact(a.unidad) === axCompact(b.unidad)) })).filter(b => b.a && b.a.activo !== false);
}

function axAplicarCorrecciones(filas){
  const igual = (f, ed, un) => axCompact(f.edificio) === axCompact(ed) && axCompact(f.unidad) === axCompact(un);
  AX_CORRECCIONES.forEach(c => {
    filas.filter(f => igual(f, c.edificio, c.unidad)).forEach(f => {
      if(c.set) Object.assign(f, c.set);
      if(c.base){ f.baseUnidad = c.base; f.renombrar = c.renombrar || null; }
      if(c.omitir) f.omitir = true;
      if(c.vaciar) f.vaciar = true;
      if(c.sinAumentosIncluidos) f.sinAumentosIncluidos = true;
      if(c.padre){
        const p = filas.find(x => igual(x, f.edificio, c.padre));
        if(p){ f.padreFila = p.fila; f.inquilino = f.inquilino || p.inquilino; f.alq_actual = 0; f.vaciar = true; }
      }
      f.correccion = c.nota;
    });
  });
}

// Objeto con la forma de "alquileres" para reutilizar las reglas de la vista (pestaña, aumento, vacante)
function axComoAlquiler(f){
  return { id: -f.fila, propietario: f.propietario, inquilino: f.inquilino, unidad: f.unidad, edificio: f.edificio,
    tipo_contrato: f.tipo_contrato, periodicidad_meses: f.periodicidad, mes_aumento: f.mes_aumento, inicio_contrato: f.inicio,
    alq_actual: f.alq_actual, alq_actual_usd: f.alq_usd, moneda: f.moneda, alq_inicial: f.alq_inicial, fecha_ultimo_ajuste: f.ultimo_ajuste };
}

// ---------- emparejar filas del Excel con la base ----------
// Palabras normalizadas: "ITUZANGO 654 -SS EE 04" → ITUZAINGO 654 SS EE 4 (sin ceros a la izquierda)
const AX_RUIDO = new Set(['PISO','DPTO','DTO','DE','DEL','LA','EL']);
function axTokens(s){
  return axNorm(s).replace(/ITUZANGO/g, 'ITUZAINGO').replace(/([A-Z])(\d)/g, '$1 $2').replace(/(\d)([A-Z])/g, '$1 $2')
    .split(/[^A-Z0-9]+/).filter(Boolean).map(t => /^\d+$/.test(t) ? String(Number(t)) : t).filter(t => !AX_RUIDO.has(t));
}
function axPuntaje(f, a){
  const B = axTokens(f.edificio), U = axTokens(f.unidad), D = axTokens(a.unidad);
  const T = axTokens(f.tipo_unidad).filter(t => t === 'BAULERA' || t === 'BICICLETERO');
  const nombre = B.filter(t => !/^\d+$/.test(t)), nums = B.filter(t => /^\d+$/.test(t));
  if(!nombre.length || !nombre.every(t => D.includes(t))) return 0; // tiene que ser el mismo edificio
  let ed = 2;
  if(nums.length) ed += nums.every(t => D.includes(t)) ? 2 : -1;      // 652 vs 654: penaliza pero no descarta
  const resto = D.filter(t => !B.includes(t) && !(nums.length === 0 && /^\d{3,}$/.test(t) && !U.includes(t)));
  const igual = (x, y) => x.length === y.length && x.every(t => y.includes(t));
  let un = 0;
  const propio = U.length && !igual(U, B);
  if(!propio && resto.length === 0) un = 4;                            // la unidad es el edificio entero (oficina, local)
  else if(propio && (igual(resto, U) || igual(resto, [...T, ...U]))) un = 4;
  else if(propio && U.every(t => resto.includes(t))) un = 2;            // "7-3" ↔ "7-3 + EE 35"
  else if(propio && resto.length && resto.some(t => /\d/.test(t)) && resto.every(t => U.includes(t))) un = 1; // "1-A + EE04" ↔ "1-A"
  const inqE = axCompact(f.inquilino), inqD = axCompact(a.inquilino);
  const pal = x => axNorm(x).split(' ').filter(w => w.length >= 4);
  const inq = inqE && inqE === inqD ? 3 : (f.inquilino && a.inquilino && pal(f.inquilino).some(w => pal(a.inquilino).includes(w)) ? 1 : 0);
  if(!un && inq < 3) return 0;
  return ed + un + inq;
}

function axEmparejar(filas, alqs){
  const pares = [];
  filas.forEach(f => alqs.forEach(a => { const s = axPuntaje(f, a); if(s >= 3) pares.push({ f, a, s }); }));
  pares.sort((x, y) => y.s - x.s);
  const usadosF = new Set(), usadosA = new Set(), match = {};
  // Bajas y emparejamientos indicados a mano
  axBajas(alqs).forEach(b => usadosA.add(b.a.id));
  filas.filter(f => f.baseUnidad).forEach(f => {
    const a = alqs.find(x => axCompact(x.unidad) === axCompact(f.baseUnidad));
    if(a){ usadosF.add(f.fila); usadosA.add(a.id); match[f.fila] = { id: a.id, puntaje: 9 }; }
  });
  pares.forEach(({ f, a, s }) => {
    if(usadosF.has(f.fila) || usadosA.has(a.id)) return;
    usadosF.add(f.fila); usadosA.add(a.id); match[f.fila] = { id: a.id, puntaje: s };
  });
  return match;
}

function axIgual(campo, antes, despues){
  if(antes === null || antes === undefined || antes === '') return despues === null || despues === '';
  if(AX_NUMERICOS.has(campo)) return Number(antes) === Number(despues);
  if(campo === 'inicio_contrato' || campo === 'fin_contrato'){
    const a = axParseFecha(antes), b = axParseFecha(despues);
    if(a && b) return a.getTime() === b.getTime();
  }
  return axNorm(antes) === axNorm(despues);
}

// Busca el propietario existente: 1) unidades de la base con ese mismo nombre ya vinculadas,
// 2) mismo nombre, 3) mismas palabras en otro orden o con segundo nombre ("Musto Damian" = "Damián Musto")
function axResolverProp(nombre, props, alqs){
  const n = axNorm(nombre);
  // DB+GB cobra en la cuenta del Fideicomiso Quadra (Ituzaingó 650)
  if(n.replace(/\s/g, '') === 'DB+GB'){ const fid = props.find(p => axNorm(p.nombre).startsWith('FIDEICOMISO')); if(fid) return fid.id; }
  const porUnidad = alqs.find(a => axNorm(a.propietario) === n && a.propietario_id && props.some(p => p.id === a.propietario_id));
  if(porUnidad) return porUnidad.propietario_id;
  const exacto = props.find(p => axNorm(p.nombre) === n);
  if(exacto) return exacto.id;
  const pal = x => axNorm(x).split(' ').filter(w => w.length >= 3);
  const w = pal(nombre);
  const parecido = props.filter(p => { const q = pal(p.nombre); return w.length >= 2 && w.every(t => q.includes(t)); });
  return parecido.length === 1 ? parecido[0].id : null;
}

function axFormatoFecha(alqs){
  const ej = alqs.map(a => a.inicio_contrato || a.fin_contrato).find(Boolean);
  return ej && String(ej).includes('/') ? 'dmy' : 'iso';
}
function axEscribirFecha(iso, formato){
  if(!iso) return null;
  if(formato === 'iso') return iso;
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

// Cambios de una fila: solo campos con valor en el Excel. Lo vacío en el Excel NO borra lo de la base,
// salvo inquilino/alquiler (unidad que quedó vacante), que se marca aparte y hay que tildar a mano.
// Último aumento que ya está incluido en el "Alquiler actual" del Excel (el del mes del Excel o anterior)
function axPeriodoSiguiente(p){ const [m, y] = p.split('-').map(Number); return m === 12 ? `01-${y + 1}` : `${String(m + 1).padStart(2,'0')}-${y}`; }
function axUltimoAjuste(f, periodoExcel){
  const per = f.periodicidad, ini = axParseFecha(f.inicio);
  if(!per || !ini || ['FIJO','SIN CONTRATO'].includes(f.tipo_contrato) || f.moneda === 'USD') return null;
  const [m, y] = periodoExcel.split('-').map(Number);
  const diff = (y - ini.getFullYear()) * 12 + (m - 1 - ini.getMonth());
  if(diff < per) return null;
  let k = diff - (diff % per);
  // Aumento del mismo mes del Excel después del día 10: todavía no está cobrado (va con diferencia el mes siguiente)
  if(k === diff && ini.getDate() > AX_DIA_LIMITE) k -= per;
  if(k < per) return null;
  return axISO(axSumarMeses(ini, k));
}

function axCambios(f, a, formato){
  const cambios = [], vacia = [];
  AX_CAMPOS.forEach(([k, col]) => {
    let nuevo = f[k];
    if(col === 'inicio_contrato' || col === 'fin_contrato') nuevo = axEscribirFecha(nuevo, formato);
    const antes = a ? a[col] : null;
    if(nuevo === null || nuevo === undefined){
      if(a && (col === 'inquilino' || col === 'alq_actual') && antes) vacia.push({ col, antes });
      return;
    }
    if(a && col === 'moneda' && !antes && nuevo === 'ARS') return;
    if(!a || !axIgual(col, antes, nuevo)) cambios.push({ col, antes: antes ?? null, nuevo });
  });
  if(a && f.alq_actual === 0 && Number(a.alq_actual) > 0){
    const i = cambios.findIndex(c => c.col === 'alq_actual');
    if(i >= 0) vacia.push(cambios.splice(i, 1)[0]);
  }
  return { cambios, vacia };
}

// ---------- pantalla ----------
async function axAbrirImportador(){
  currentView = 'importar';
  const main = document.getElementById('main');
  main.innerHTML = `
    <div class="page-header" style="display:flex;justify-content:space-between;align-items:flex-start">
      <div><h2>Importar Excel de alquileres</h2><p>Primero se muestra un resumen y los cambios. No se guarda nada hasta que confirmes.</p></div>
      <button class="btn-sm" onclick="currentView='alquileres2';loadAlquileres()">← Volver</button>
    </div>
    <div class="stat-card" style="margin-bottom:16px">
      <input type="file" id="ax-xlsx" accept=".xlsx,.xls" onchange="axLeerArchivo(this.files[0])">
      <div style="font-size:12px;color:var(--text-3);margin-top:6px">Se ignoran "Monto a reponer", "A reponer a" y las filas internas del final (comisiones, gastos, transferencias).</div>
    </div>
    <div id="ax-import-out"></div>`;
  if(typeof XLSX === 'undefined'){
    await new Promise((ok, mal) => { const s = document.createElement('script'); s.src = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js'; s.onload = ok; s.onerror = () => mal(new Error('No se pudo cargar el lector de Excel')); document.head.appendChild(s); })
      .catch(e => { document.getElementById('ax-import-out').innerHTML = `<div style="color:var(--red)">${axH(e.message)}</div>`; });
  }
}

async function axLeerArchivo(file){
  const out = document.getElementById('ax-import-out');
  if(!file) return;
  out.innerHTML = '<div class="loading"><div class="spinner"></div><span>Leyendo Excel y comparando con la base...</span></div>';
  try {
    const wb = XLSX.read(await file.arrayBuffer());
    const { filas, ignoradas } = axLeerHoja(wb.Sheets[wb.SheetNames[0]]);
    const [r1, r2] = await Promise.all([db.from('alquileres').select('*').order('id'), db.from('propietarios').select('*')]);
    if(r1.error) throw r1.error;
    const alqs = r1.data || [], props = r2.data || [];
    const formato = axFormatoFecha(alqs);
    const match = axEmparejar(filas, alqs);
    filas.forEach(f => {
      f.matchId = match[f.fila]?.id ?? null;
      f.puntaje = match[f.fila]?.puntaje ?? 0;
    });
    const nombresProp = [...new Set(filas.map(f => f.propietario).filter(Boolean))];
    const nuevosProps = nombresProp.filter(n => !axResolverProp(n, props, alqs));
    // Mes del Excel: se toma del nombre del archivo (ej. "OCTUBRE ALQUILERES.xlsx"); se puede cambiar en pantalla
    const [hm, hy] = axHoyPeriodo().split('-').map(Number);
    const nombreN = axNorm(file.name);
    const mesArch = AX_MESES.findIndex((n, i) => i > 0 && nombreN.includes(axNorm(n)));
    const mes = mesArch > 0 ? mesArch : hm;
    const periodo = `${String(mes).padStart(2,'0')}-${mes > hm ? hy - 1 : hy}`;
    axImp = { filas, alqs, props, formato, nuevosProps, ignoradas, nombre: file.name, periodo };
    axRenderImport();
  } catch(e) {
    out.innerHTML = `<div style="background:var(--red-bg);color:var(--red);padding:12px 16px;border-radius:var(--radius)">❌ ${axH(e.message)}</div>`;
  }
}

function axRenderImport(){
  const { filas, alqs, formato, nuevosProps, ignoradas } = axImp;
  const out = document.getElementById('ax-import-out');
  const porId = Object.fromEntries(alqs.map(a => [a.id, a]));
  const [em, ey] = axImp.periodo.split('-').map(Number);
  const prox = em === 12 ? `01-${ey + 1}` : `${String(em + 1).padStart(2,'0')}-${ey}`;
  filas.forEach(f => { f.ultimo_ajuste = f.sinAumentosIncluidos ? null : axUltimoAjuste(f, axImp.periodo); });
  const opcionesMes = [];
  for(let i = -3; i <= 1; i++){
    const d = new Date(new Date().getFullYear(), new Date().getMonth() + i, 1);
    const p = `${String(d.getMonth()+1).padStart(2,'0')}-${d.getFullYear()}`;
    opcionesMes.push(`<option value="${p}" ${p === axImp.periodo ? 'selected' : ''}>${axFmtPeriodo(p)}</option>`);
  }

  // Resumen por pestaña y propietario
  const res = {};
  filas.filter(f => !f.omitir).forEach(f => {
    const x = axComoAlquiler(f);
    const tab = !f.propietario ? 'Sin propietario' : axTabDe(x) === 'dbgb' ? 'DB / GB' : 'Propietarios';
    const k = `${tab}|${f.propietario || '(sin propietario)'}`;
    const r = res[k] = res[k] || { tab, prop: f.propietario || '(sin propietario)', act: 0, vac: 0, ars: 0, usd: 0 };
    if(axActiva(x)){ r.act++; if(f.moneda === 'USD') r.usd += f.alq_usd; else r.ars += f.alq_actual; } else r.vac++;
  });
  const resFilas = Object.values(res).sort((a, b) => a.tab.localeCompare(b.tab) || a.prop.localeCompare(b.prop, 'es'));
  const vacantes = filas.filter(f => !f.omitir && !f.padreFila && !axActiva(axComoAlquiler(f)));
  const aumentos = filas.filter(f => !f.omitir).map(f => ({ f, au: axAumentoCobro(axComoAlquiler(f), prox) })).filter(x => x.au && !x.au.soloTexto && !x.au.yaIncluido && axActiva(axComoAlquiler(x.f)));
  const sinProp = filas.filter(f => !f.propietario && !f.omitir);
  const corregidas = filas.filter(f => f.correccion);

  // Cambios
  filas.forEach(f => {
    const a = f.matchId ? porId[f.matchId] : null;
    Object.assign(f, axCambios(f, a, formato));
    // Unidades incluidas en el alquiler de otra (cocheras del depto): se vinculan con parent_id
    if(f.padreFila){
      const padre = filas.find(x => x.fila === f.padreFila);
      if(a && (!a.parent_id || a.parent_id === a.id) && padre?.matchId) f.cambios.push({ col: 'parent_id', antes: null, nuevo: padre.matchId, texto: `parte de ${padre.edificio} ${padre.unidad}` });
    }
    if(a && f.renombrar && a.unidad !== f.renombrar) f.cambios.unshift({ col: 'unidad', antes: a.unidad, nuevo: f.renombrar });
    if(f.omitir){ f.aplicar = false; f.cambios = []; f.vacia = []; }
    if(f.aplicar === undefined) f.aplicar = a ? f.cambios.length > 0 : !!f.inquilino;
    if(f.vaciar === undefined) f.vaciar = false;
  });
  const conCambios = filas.filter(f => f.matchId && f.cambios.length);
  const sinCambios = filas.filter(f => f.matchId && !f.cambios.length && !f.vacia.length);
  const nuevas = filas.filter(f => !f.matchId && !f.omitir);
  const usados = new Set(filas.map(f => f.matchId).filter(Boolean));
  const bajas = axBajas(alqs);
  const noEnExcel = alqs.filter(a => !usados.has(a.id) && !bajas.some(b => b.a.id === a.id));
  const opcionesBase = alqs.map(a => `<option value="${a.id}">#${a.id} · ${axH(axNombreUnidad(a))} · ${axH(a.inquilino || 'sin inquilino')}</option>`).join('');
  const nombreCampo = c => c.replace(/_/g, ' ');
  const val = v => v === null || v === undefined || v === '' ? '<span style="color:var(--text-3)">vacío</span>' : axH(v);

  const tabla = (titulo, cuerpo) => `<div class="group-section" style="margin-bottom:18px"><div class="group-header"><span class="group-title">${titulo}</span></div>
    <div class="table-wrap" style="border-radius:0 0 var(--radius) var(--radius);border-top:none">${cuerpo}</div></div>`;
  const tdS = 'style="white-space:normal;font-size:12px;padding:8px 12px;vertical-align:top"';

  out.innerHTML = `
    <div style="font-size:13px;color:var(--text-2);margin-bottom:14px">Archivo <b>${axH(axImp.nombre)}</b>: ${filas.length} unidades leídas · ${ignoradas} filas internas del final ignoradas.
      · Mes del Excel: <select onchange="axImp.periodo=this.value;axRenderImport()" style="font-family:inherit;font-size:12px">${opcionesMes.join('')}</select>
      <div style="font-size:11px;color:var(--text-3);margin-top:4px">Los aumentos que tocaban hasta ese mes se toman como ya incluidos en el "Alquiler actual" del Excel, para no aplicarlos dos veces.</div></div>

    ${tabla('1 · Resumen por pestaña y propietario', `<table style="table-layout:auto"><thead><tr><th>Pestaña</th><th>Propietario</th><th>Activas</th><th>Vacantes / sin importe</th><th>Alquileres $</th><th>Alquileres USD</th></tr></thead><tbody>
      ${resFilas.map(r => `<tr style="cursor:default"><td ${tdS}>${r.tab}</td><td ${tdS}>${axH(r.prop)}</td><td ${tdS}>${r.act}</td><td ${tdS}>${r.vac}</td><td ${tdS}>${axPesos(r.ars)}</td><td ${tdS}>${r.usd ? axUSD(r.usd) : '—'}</td></tr>`).join('')}
      </tbody></table>`)}

    ${corregidas.length ? `<div style="background:var(--green-bg);color:var(--green);border-radius:var(--radius);padding:10px 14px;margin-bottom:16px;font-size:12px"><b>Correcciones que me indicaste (ya aplicadas en este resumen):</b>
      ${corregidas.map(f => `<div>· Fila ${f.fila} ${axH(f.edificio)} ${axH(f.unidad || '')}: ${axH(f.correccion)}</div>`).join('')}</div>` : ''}
    ${sinProp.length ? `<div style="background:var(--orange-bg);color:var(--orange);border-radius:var(--radius);padding:10px 14px;margin-bottom:16px;font-size:12px">⚠ Sin propietario en el Excel: ${sinProp.map(f => `fila ${f.fila} (${axH(f.edificio)} ${axH(f.unidad || '')})`).join(', ')}. Se importa sin cambiar el propietario que tenga hoy la base.</div>` : ''}

    ${tabla(`2 · Vacantes / sin importe (${vacantes.length})`, `<table style="table-layout:auto"><tbody>
      ${vacantes.map(f => `<tr style="cursor:default"><td ${tdS}>Fila ${f.fila}</td><td ${tdS}>${axH(f.edificio)} · ${axH(f.tipo_unidad || '')} ${axH(f.unidad || '')}</td><td ${tdS}>${axH(f.propietario || '—')}</td><td ${tdS}>${axH(f.inquilino || 'sin inquilino')}</td></tr>`).join('')}
      </tbody></table>`)}

    ${tabla(`3 · Aumentos ICL en ${axFmtPeriodo(prox)} (${aumentos.length})`, `<table style="table-layout:auto"><thead><tr><th>Unidad</th><th>Inquilino</th><th>Contrato</th><th>Rige desde</th><th>Alquiler actual</th><th>Nota</th></tr></thead><tbody>
      ${aumentos.map(({ f, au }) => `<tr style="cursor:default"><td ${tdS}>${axH(f.edificio)} ${axH(f.unidad)}</td><td ${tdS}>${axH(f.inquilino)}</td><td ${tdS}>${axH(f.tipo_contrato)}</td><td ${tdS}>${au.fechaAjuste ? axFmtFecha(au.fechaAjuste) : '—'}</td><td ${tdS}>${axPesos(f.alq_actual)}</td><td ${tdS}>${au.cobroSiguiente ? `Después del ${AX_DIA_LIMITE}: se cobra con diferencia en ${axFmtPeriodo(axPeriodoSiguiente(prox))}` : au.diferenciaMesAnterior ? `Rigió en ${axFmtPeriodo(axImp.periodo)} después del ${AX_DIA_LIMITE}: se cobra ahora + diferencia` : 'Proporcional en el mes'}${au.diferencia ? '<br><span style="color:var(--orange)">⚠ no coincide con MES AUMENTO</span>' : ''}</td></tr>`).join('')}
      </tbody></table>`)}

    ${nuevosProps.length ? `<div style="background:var(--blue-bg);color:var(--blue);border-radius:var(--radius);padding:10px 14px;margin-bottom:16px;font-size:12px">
      Propietarios que no están en la tabla de propietarios y se van a crear (solo el nombre): <b>${nuevosProps.map(axH).join(', ')}</b></div>` : ''}

    ${tabla(`4 · Unidades que cambian (${conCambios.length + filas.filter(f => f.matchId && !f.cambios.length && f.vacia.length).length})`, `<table style="table-layout:auto"><thead><tr><th style="width:40px">Aplicar</th><th>Excel</th><th>En la base</th><th>Qué cambia (antes → después)</th></tr></thead><tbody>
      ${filas.filter(f => f.matchId && (f.cambios.length || f.vacia.length)).map(f => {
        const a = porId[f.matchId];
        return `<tr style="cursor:default">
          <td ${tdS}><input type="checkbox" ${f.aplicar ? 'checked' : ''} onchange="axImpSet(${f.fila},'aplicar',this.checked)"></td>
          <td ${tdS}><b>Fila ${f.fila}</b><br>${axH(f.edificio)} ${axH(f.unidad)}<br><span style="color:var(--text-3)">${axH(f.inquilino || '')}</span></td>
          <td ${tdS}><select onchange="axImpMatch(${f.fila},this.value)" style="max-width:240px;font-size:11px"><option value="">— unidad nueva —</option>${opcionesBase.replace(`value="${a.id}"`, `value="${a.id}" selected`)}</select>
            ${f.puntaje < 5 ? '<div style="color:var(--orange);font-size:11px;margin-top:3px">⚠ coincidencia dudosa, revisá</div>' : ''}</td>
          <td ${tdS}>${f.cambios.map(c => `<div><span style="color:var(--text-3)">${nombreCampo(c.col)}:</span> ${val(c.antes)} → <b>${c.texto ? axH(c.texto) : val(c.nuevo)}</b></div>`).join('')}
            ${f.vacia.length ? `<div style="margin-top:6px;color:var(--red)"><label><input type="checkbox" ${f.vaciar ? 'checked' : ''} onchange="axImpSet(${f.fila},'vaciar',this.checked)"> En el Excel figura vacante: vaciar ${f.vacia.map(v => `${nombreCampo(v.col)} (hoy: ${axH(v.antes)})`).join(' y ')}</label></div>` : ''}</td>
        </tr>`;
      }).join('') || `<tr><td ${tdS} colspan="4">Ninguna</td></tr>`}
      </tbody></table>`)}

    ${tabla(`5 · Unidades del Excel que no encontré en la base (${nuevas.length})`, `<table style="table-layout:auto"><thead><tr><th style="width:40px">Crear</th><th>Excel</th><th>¿Es alguna de estas?</th></tr></thead><tbody>
      ${nuevas.map(f => `<tr style="cursor:default">
        <td ${tdS}><input type="checkbox" ${f.aplicar ? 'checked' : ''} onchange="axImpSet(${f.fila},'aplicar',this.checked)"></td>
        <td ${tdS}><b>Fila ${f.fila}</b> · ${axH(f.edificio)} ${axH(f.tipo_unidad || '')} ${axH(f.unidad || '')} · ${axH(f.propietario || 'sin propietario')} · ${axH(f.inquilino || 'sin inquilino')}</td>
        <td ${tdS}><select onchange="axImpMatch(${f.fila},this.value)" style="max-width:300px;font-size:11px"><option value="">— crear como unidad nueva —</option>${opcionesBase}</select></td>
      </tr>`).join('') || `<tr><td ${tdS} colspan="3">Ninguna</td></tr>`}
      </tbody></table>`)}

    ${bajas.length ? tabla(`6 · Salen del listado (${bajas.length}) — no se borran, quedan guardadas como inactivas`, `<table style="table-layout:auto"><tbody>
      ${bajas.map(b => `<tr style="cursor:default"><td ${tdS}>#${b.a.id} ${axH(b.a.unidad)}</td><td ${tdS}>${axH(b.a.inquilino || 'sin inquilino')}</td><td ${tdS}>${axH(b.nota)}</td></tr>`).join('')}
      </tbody></table>`) : ''}

    <details style="margin-bottom:18px"><summary style="cursor:pointer;font-size:13px;color:var(--text-2)">Sin cambios (${sinCambios.length}) · En la base pero no en el Excel, no se tocan (${noEnExcel.length})</summary>
      <div style="font-size:12px;color:var(--text-2);margin-top:8px"><b>Sin cambios:</b> ${sinCambios.map(f => `${axH(f.edificio)} ${axH(f.unidad)}`).join(' · ') || '—'}</div>
      <div style="font-size:12px;color:var(--text-2);margin-top:8px"><b>No están en el Excel:</b> ${noEnExcel.map(a => `#${a.id} ${axH(axNombreUnidad(a))}`).join(' · ') || '—'}</div>
    </details>

    <div style="background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:14px 16px;display:flex;justify-content:space-between;align-items:center;gap:12px">
      <div style="font-size:12px;color:var(--text-2)">Antes de guardar se descarga un respaldo (.json) con la tabla de alquileres tal como está hoy. No se borra ninguna fila.</div>
      <button class="btn-primary" onclick="axAplicarImport()">Aplicar ${filas.filter(f => f.aplicar).length} cambios</button>
    </div>
    <div id="ax-import-log" style="font-size:12px;margin-top:12px"></div>`;
}

function axImpSet(fila, k, v){ const f = axImp.filas.find(x => x.fila === fila); if(f) f[k] = v; axRenderImport(); }
function axImpMatch(fila, id){
  const f = axImp.filas.find(x => x.fila === fila); if(!f) return;
  const nuevo = id ? Number(id) : null;
  if(nuevo){ const otro = axImp.filas.find(x => x.matchId === nuevo && x.fila !== fila); if(otro){ otro.matchId = null; otro.aplicar = undefined; } }
  f.matchId = nuevo; f.puntaje = 9; f.aplicar = undefined;
  axRenderImport();
}

async function axAplicarImport(){
  const sel = axImp.filas.filter(f => f.aplicar || (f.matchId && f.vaciar));
  if(sel.length === 0){ showToast('No hay nada tildado'); return; }
  const actualizar = sel.filter(f => f.matchId).length + axBajas(axImp.alqs).length, crear = sel.filter(f => !f.matchId).length;
  if(!confirm(`Se van a actualizar ${actualizar} unidades y crear ${crear} nuevas${axImp.nuevosProps.length ? ` y ${axImp.nuevosProps.length} propietarios` : ''}.\nNo se borra ninguna fila. ¿Continuar?`)) return;

  // Respaldo
  const blob = new Blob([JSON.stringify(axImp.alqs, null, 1)], { type: 'application/json' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob); link.download = `respaldo_alquileres_${axISO(new Date())}.json`; link.click();

  const log = document.getElementById('ax-import-log');
  const escribir = (t, err) => { log.innerHTML += `<div style="color:${err ? 'var(--red)' : 'var(--text-2)'}">${t}</div>`; };
  let props = axImp.props.slice();
  for(const nombre of axImp.nuevosProps){
    const { data, error } = await db.from('propietarios').insert({ nombre }).select().single();
    if(error) escribir(`❌ Propietario ${axH(nombre)}: ${axH(error.message)}`, true);
    else { props.push(data); escribir(`✓ Propietario creado: ${axH(nombre)}`); }
  }
  const idProp = n => axResolverProp(n, props, axImp.alqs);
  const tieneDireccion = axImp.alqs.some(a => 'direccion' in a);
  // La tabla alquileres no genera el id sola: se usa el siguiente al más alto
  let proximoId = Math.max(0, ...axImp.alqs.map(a => Number(a.id) || 0)) + 1;
  let ok = 0, err = 0;
  const idPorFila = Object.fromEntries(axImp.filas.filter(f => f.matchId).map(f => [f.fila, f.matchId]));
  for(const f of sel){
    const a = f.matchId ? axImp.alqs.find(x => x.id === f.matchId) : null;
    const upd = {};
    if(f.aplicar) f.cambios.forEach(c => { upd[c.col] = c.nuevo; });
    if(a && f.vaciar) f.vacia.forEach(v => { upd[v.col] = v.col === 'alq_actual' ? 0 : null; });
    if(f.propietario){ const pid = idProp(f.propietario); if(pid && (!a || a.propietario_id !== pid)) upd.propietario_id = pid; }
    if(!a && f.padreFila && idPorFila[f.padreFila]) upd.parent_id = idPorFila[f.padreFila];
    if(Object.keys(upd).length === 0) continue;
    let res;
    if(a) res = await db.from('alquileres').update(upd).eq('id', a.id);
    else {
      res = await db.from('alquileres').insert({ id: proximoId++, unidad: [f.edificio, f.unidad].filter(Boolean).join(' '), ...(tieneDireccion ? { direccion: f.edificio } : {}), ...upd }).select().single();
      if(!res.error && res.data) idPorFila[f.fila] = res.data.id;
    }
    if(res.error){ err++; escribir(`❌ Fila ${f.fila} (${axH(f.edificio)} ${axH(f.unidad)}): ${axH(res.error.message)}`, true); }
    else ok++;
  }
  for(const b of axBajas(axImp.alqs)){
    const res = await db.from('alquileres').update({ activo: false }).eq('id', b.a.id);
    if(res.error){ err++; escribir(`❌ No se pudo quitar del listado ${axH(b.a.unidad)}: ${axH(res.error.message)}`, true); }
    else { ok++; escribir(`✓ Quitada del listado: ${axH(b.a.unidad)} (${axH(b.nota)})`); }
  }
  escribir(`<b>Listo: ${ok} unidades guardadas${err ? `, ${err} con error` : ''}.</b> <a href="#" onclick="event.preventDefault();currentView='alquileres2';loadAlquileres()">Ir a Alquileres →</a>`);
  showToast(`Importación terminada: ${ok} ok${err ? `, ${err} con error` : ''}`);
}
