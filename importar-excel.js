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
  ['propietario','propietario'], ['inquilino','inquilino'], ['cobra','cobra'], ['edificio','edificio'], ['tipo_unidad','tipo_unidad'],
  ['inicio','inicio_contrato'], ['fin','fin_contrato'], ['tipo_contrato','tipo_contrato'], ['periodicidad','periodicidad_meses'],
  ['mes_aumento','mes_aumento'], ['alq_inicial','alq_inicial'], ['alq_actual','alq_actual'], ['alq_usd','alq_actual_usd'], ['moneda','moneda'],
  ['comision_pct','comision_pct'], ['comision','comision_adm'], ['expensas','expensas_monto'],
  ['tel_inquilino','tel_inquilino'], ['email_inquilino','email_inquilino'], ['adm_email','adm_contacto'], ['adm_telefono','tel_adm'],
  ['seguro','seguro'], ['tgi_cuenta','tgi_cuenta'], ['tgi_gestion','tgi_gestion'], ['api','api'], ['aguas','aguas'],
  ['gas_cliente','gas_cliente'], ['gas_persona','gas_persona'], ['epe_cliente','epe_cliente'], ['epe_plan','epe_plan'],
  ['ultimo_ajuste','fecha_ultimo_ajuste'],
];
const AX_NUMERICOS = new Set(['alq_inicial','alq_actual','alq_actual_usd','comision_pct','comision_adm','expensas_monto','periodicidad_meses']);

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
      comision: axNum(g('comision_r')) || axNum(g('comision_s')),
      expensas: axNum(g('expensas')),
      tel_inquilino: axCelda(g('tel_inquilino')), email_inquilino: axCelda(g('email_inquilino')),
      adm_email: axCelda(g('adm_email')), adm_telefono: axCelda(g('adm_telefono')), seguro: axCelda(g('seguro')),
      tgi_cuenta: axCelda(g('tgi_cuenta')), tgi_gestion: axCelda(g('tgi_gestion')), api: axCelda(g('api')), aguas: axCelda(g('aguas')),
      gas_cliente: axCelda(g('gas_cliente')), gas_persona: axCelda(g('gas_persona')), epe_cliente: axCelda(g('epe_cliente')), epe_plan: axCelda(g('epe_plan')),
    });
  }
  return { filas, ignoradas };
}

// Objeto con la forma de "alquileres" para reutilizar las reglas de la vista (pestaña, aumento, vacante)
function axComoAlquiler(f){
  return { id: -f.fila, propietario: f.propietario, inquilino: f.inquilino, unidad: f.unidad, edificio: f.edificio,
    tipo_contrato: f.tipo_contrato, periodicidad_meses: f.periodicidad, mes_aumento: f.mes_aumento, inicio_contrato: f.inicio,
    alq_actual: f.alq_actual, alq_actual_usd: f.alq_usd, moneda: f.moneda };
}

// ---------- emparejar filas del Excel con la base ----------
function axPuntaje(f, a){
  const dbUni = axCompact(a.unidad), dbTodo = axCompact(`${a.edificio || ''} ${a.direccion || ''} ${a.unidad || ''}`);
  const u = axCompact(f.unidad), tu = axCompact(`${f.tipo_unidad || ''} ${f.unidad || ''}`);
  const nro = (f.edificio || '').match(/\d+/g)?.join('') || '';
  const nombreEd = axCompact((f.edificio || '').replace(/\d+/g, '')).slice(0, 6);
  let ed = 0, un = 0, inq = 0;
  if(nro && dbTodo.includes(nro)) ed = 2; else if(nombreEd && dbTodo.includes(nombreEd)) ed = 1;
  const variantes = [u, tu, axCompact(`${f.edificio} ${f.unidad}`), axCompact(`${f.edificio} ${f.tipo_unidad} ${f.unidad}`)].filter(Boolean);
  if(variantes.includes(dbUni)) un = 3;
  else if(u.length >= 2 && variantes.some(v => dbUni.endsWith(v) && !/\d/.test(dbUni[dbUni.length - v.length - 1] || ''))) un = 2;
  const pal = s => axNorm(s).split(' ').filter(w => w.length >= 4);
  if(f.inquilino && a.inquilino && pal(f.inquilino).some(w => pal(a.inquilino).includes(w))) inq = 2;
  if(!ed || (!un && !inq)) return 0;
  return ed + un + inq;
}

function axEmparejar(filas, alqs){
  const pares = [];
  filas.forEach(f => alqs.forEach(a => { const s = axPuntaje(f, a); if(s >= 4) pares.push({ f, a, s }); }));
  pares.sort((x, y) => y.s - x.s);
  const usadosF = new Set(), usadosA = new Set(), match = {};
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
function axUltimoAjuste(f, periodoExcel){
  const per = f.periodicidad, ini = axParseFecha(f.inicio);
  if(!per || !ini || ['FIJO','SIN CONTRATO'].includes(f.tipo_contrato) || f.moneda === 'USD') return null;
  const [m, y] = periodoExcel.split('-').map(Number);
  const diff = (y - ini.getFullYear()) * 12 + (m - 1 - ini.getMonth());
  if(diff < per) return null;
  return axISO(axSumarMeses(ini, diff - (diff % per)));
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
    const nuevosProps = nombresProp.filter(n => !props.some(p => axNorm(p.nombre) === axNorm(n)));
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
  filas.forEach(f => { f.ultimo_ajuste = axUltimoAjuste(f, axImp.periodo); });
  const opcionesMes = [];
  for(let i = -3; i <= 1; i++){
    const d = new Date(new Date().getFullYear(), new Date().getMonth() + i, 1);
    const p = `${String(d.getMonth()+1).padStart(2,'0')}-${d.getFullYear()}`;
    opcionesMes.push(`<option value="${p}" ${p === axImp.periodo ? 'selected' : ''}>${axFmtPeriodo(p)}</option>`);
  }

  // Resumen por pestaña y propietario
  const res = {};
  filas.forEach(f => {
    const x = axComoAlquiler(f);
    const tab = !f.propietario ? 'Sin propietario' : axTabDe(x) === 'dbgb' ? 'DB / GB' : 'Propietarios';
    const k = `${tab}|${f.propietario || '(sin propietario)'}`;
    const r = res[k] = res[k] || { tab, prop: f.propietario || '(sin propietario)', act: 0, vac: 0, ars: 0, usd: 0 };
    if(axActiva(x)){ r.act++; if(f.moneda === 'USD') r.usd += f.alq_usd; else r.ars += f.alq_actual; } else r.vac++;
  });
  const resFilas = Object.values(res).sort((a, b) => a.tab.localeCompare(b.tab) || a.prop.localeCompare(b.prop, 'es'));
  const vacantes = filas.filter(f => !axActiva(axComoAlquiler(f)));
  const aumentos = filas.map(f => ({ f, au: axAumento(axComoAlquiler(f), prox) })).filter(x => x.au && axActiva(axComoAlquiler(x.f)));
  const sinProp = filas.filter(f => !f.propietario);

  // Cambios
  filas.forEach(f => {
    const a = f.matchId ? porId[f.matchId] : null;
    Object.assign(f, axCambios(f, a, formato));
    if(f.aplicar === undefined) f.aplicar = a ? f.cambios.length > 0 : !!f.inquilino;
    if(f.vaciar === undefined) f.vaciar = false;
  });
  const conCambios = filas.filter(f => f.matchId && f.cambios.length);
  const sinCambios = filas.filter(f => f.matchId && !f.cambios.length && !f.vacia.length);
  const nuevas = filas.filter(f => !f.matchId);
  const usados = new Set(filas.map(f => f.matchId).filter(Boolean));
  const noEnExcel = alqs.filter(a => !usados.has(a.id));
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

    ${sinProp.length ? `<div style="background:var(--orange-bg);color:var(--orange);border-radius:var(--radius);padding:10px 14px;margin-bottom:16px;font-size:12px">⚠ Sin propietario en el Excel: ${sinProp.map(f => `fila ${f.fila} (${axH(f.edificio)} ${axH(f.unidad || '')})`).join(', ')}. Se importa sin cambiar el propietario que tenga hoy la base.</div>` : ''}

    ${tabla(`2 · Vacantes / sin importe (${vacantes.length})`, `<table style="table-layout:auto"><tbody>
      ${vacantes.map(f => `<tr style="cursor:default"><td ${tdS}>Fila ${f.fila}</td><td ${tdS}>${axH(f.edificio)} · ${axH(f.tipo_unidad || '')} ${axH(f.unidad || '')}</td><td ${tdS}>${axH(f.propietario || '—')}</td><td ${tdS}>${axH(f.inquilino || 'sin inquilino')}</td></tr>`).join('')}
      </tbody></table>`)}

    ${tabla(`3 · Aumentos ICL en ${axFmtPeriodo(prox)} (${aumentos.length})`, `<table style="table-layout:auto"><thead><tr><th>Unidad</th><th>Inquilino</th><th>Contrato</th><th>Rige desde</th><th>Alquiler actual</th><th>Nota</th></tr></thead><tbody>
      ${aumentos.map(({ f, au }) => `<tr style="cursor:default"><td ${tdS}>${axH(f.edificio)} ${axH(f.unidad)}</td><td ${tdS}>${axH(f.inquilino)}</td><td ${tdS}>${axH(f.tipo_contrato)}</td><td ${tdS}>${au.fechaAjuste ? axFmtFecha(au.fechaAjuste) : '—'}</td><td ${tdS}>${axPesos(f.alq_actual)}</td><td ${tdS}>${au.diferencia ? '<span style="color:var(--orange)">⚠ no coincide con MES AUMENTO</span>' : ''}</td></tr>`).join('')}
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
          <td ${tdS}>${f.cambios.map(c => `<div><span style="color:var(--text-3)">${nombreCampo(c.col)}:</span> ${val(c.antes)} → <b>${val(c.nuevo)}</b></div>`).join('')}
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
  const actualizar = sel.filter(f => f.matchId).length, crear = sel.filter(f => !f.matchId).length;
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
  const idProp = n => props.find(p => axNorm(p.nombre) === axNorm(n))?.id ?? null;
  const tieneDireccion = axImp.alqs.some(a => 'direccion' in a);
  let ok = 0, err = 0;
  for(const f of sel){
    const a = f.matchId ? axImp.alqs.find(x => x.id === f.matchId) : null;
    const upd = {};
    if(f.aplicar) f.cambios.forEach(c => { upd[c.col] = c.nuevo; });
    if(a && f.vaciar) f.vacia.forEach(v => { upd[v.col] = v.col === 'alq_actual' ? 0 : null; });
    if(f.propietario){ const pid = idProp(f.propietario); if(pid && (!a || a.propietario_id !== pid)) upd.propietario_id = pid; }
    if(Object.keys(upd).length === 0) continue;
    let res;
    if(a) res = await db.from('alquileres').update(upd).eq('id', a.id);
    else res = await db.from('alquileres').insert({ unidad: f.unidad || f.edificio, ...(tieneDireccion ? { direccion: f.edificio } : {}), ...upd });
    if(res.error){ err++; escribir(`❌ Fila ${f.fila} (${axH(f.edificio)} ${axH(f.unidad)}): ${axH(res.error.message)}`, true); }
    else ok++;
  }
  escribir(`<b>Listo: ${ok} unidades guardadas${err ? `, ${err} con error` : ''}.</b> <a href="#" onclick="event.preventDefault();currentView='alquileres2';loadAlquileres()">Ir a Alquileres →</a>`);
  showToast(`Importación terminada: ${ok} ok${err ? `, ${err} con error` : ''}`);
}
