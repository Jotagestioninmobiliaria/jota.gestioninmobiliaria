# Alquileres · estado y pendientes (21/10/2026)

Rama de trabajo: `claude/amazing-goldberg-tquziz` (todavía no pasada a `main`).
La usuaria prueba en el Preview de Vercel (GitHub → Deployments → Preview, Ctrl+F5).

## Hecho en la rama
- **Parte 1** (`alquileres.js`, `importar-excel.js`): mes actual por pestañas DB / DB + GB / Propietarios,
  aumentos ICL en cadena (método COCIR, regla del día 10), IVA, honorarios, WhatsApp por inquilino,
  Avisado / Pagado / Rendido.
- **Deudas** (`sql/2026-10_deudas.sql`, ya corrido): pestaña 💸 Deudores, deuda automática desde 11-2026,
  deuda anterior cargada a mano (tabla `deudas`), intereses por mora por unidad (`interes_mensual`),
  pagos aplicados a lo más atrasado (intereses y después capital), pagos parciales, anular último pago (tabla `cobros`).
  Ya cargadas: Panadería (ago/sep con intereses incluidos hasta octubre, oct) y las 2 cocheras PB EE 61/62 (oct), todas con 5%.
- **Parte 2** (`sql/2026-10_servicios.sql`, **falta confirmar que se corrió**): pestaña 🧾 Impuestos y servicios.
  TGI/Aguas/EPE/Gas: 📤 boleta enviada, ✓ comprobante, — no corresponde. Expensas: ✓ recibidas + extraordinarias
  (se descuentan del alquiler del mes). API: la paga MAO (monto, se descuenta al propietario) o "Anual hasta MM-AAAA".

## Reglas de trabajo con la usuaria
- Mostrar el plan antes de tocar código; no borrar datos sin confirmarlo.
- Explicar todo en pasos simples (no es técnica). No pedir contraseñas ni claves.
- El repo es público: no subir datos personales (Excel, respaldos, números de cuenta).

## Pendientes
1. Probar boletas por mail: Gmail conectado pasa a ser la casilla de boletas de MAO. Buscar la factura de Litoral Gas
   y reconocer la unidad por el número de cliente (comparar con `gas_cliente` de `alquileres`).
2. TGI (siat.rosario.gob.ar) y API (www.santafe.gob.ar/e-in-liq-deuda/): probar si se puede bajar la boleta sin captcha,
   una vez que la usuaria habilite esos dominios en el entorno.
3. Botón "Enviar todos": abrir los WhatsApp del mes uno tras otro y marcar avisado.
4. Revisión automática el día 1 y el 11 de cada mes con resumen (deudores, aumentos, boletas/comprobantes faltantes).
5. Marcar como "API anual hasta 12-2026" las unidades que la tienen paga por adelantado (pedir la lista de las que paga MAO).
6. Expensas de DUV "01-01" (la usuaria confirma datos).
7. Parte 3: informe y mail al propietario (descuentos: extraordinarias, API pagada por MAO, honorarios).
8. Pasar la rama a producción (PR a `main`) cuando la usuaria lo apruebe.
