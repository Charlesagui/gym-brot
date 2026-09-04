# Roadmap de mejoras — contratos vigentes

Este documento registra las decisiones que sostienen las fases nuevas. El estado de la
implementación se verifica en el código y los tests; acá quedan los contratos que no deben
fragmentarse entre pantallas.

## Datos y migración (v10)

- El peso corporal vive en `pesosCorporales`, separado de las sesiones. La fecha local
  `YYYY-MM-DD` es su clave: hay una medición principal editable por día. El valor canónico es
  `pesoGramos`; alternar kg/lb solo cambia su presentación.
- La meta actual es opcional y vive como `Ajustes.metaPesoGramos`. No se interpreta subir o
  bajar como algo positivo por sí mismo.
- El esfuerzo de una serie se persiste únicamente como `rir`, entre 0 y 5 en pasos de 0,5.
  RPE es una vista (`10 - RIR`), no una segunda fuente de verdad. `modoEsfuerzo` comienza en
  `off`, y una serie puede completarse sin registrar esfuerzo.
- La métrica de PR se resuelve en una sola función: reps para ejercicios sin carga; en los
  demás, `metricasPrEjercicio[exerciseId]` y luego `metricaPr` como fallback.
- La doble progresión pertenece al ejercicio dentro de la rutina (`Dia.ejercicios[].progresion`).
  La configuración y cualquier carga aceptada se guardan en gramos. Una recomendación nunca
  reescribe sesiones anteriores.

## Backup

El formato 2 agrega `pesosCorporales`; los campos RIR, meta, overrides y progresión viajan dentro
de las estructuras que ya los contienen. Los backups v1 sin la colección nueva siguen siendo
aceptados. `exerciseIds` continúa excluido por ser un índice derivado. Exportar e importar cubre
todas las tablas de usuario en una única transacción.

## Actividad y Wake Lock

- El heatmap usa buckets fijos de series completas: 0, 1–4, 5–8, 9–12 y 13+. Una sesión vacía o
  una serie pendiente nunca cuenta como entrenamiento.
- El Wake Lock se usa durante un descanso activo, que es el tramo donde la pantalla debe seguir
  visible. Se libera al vencer o cancelar y se vuelve a pedir al recuperar visibilidad. La falta
  de soporte o un rechazo no altera el timer.

## Distribución muscular estimada

- Sólo cuentan series completas del período. Cada serie suma 1 al músculo principal y 0,4 a cada
  secundario. Los kilos no se usan para comparar músculos.
- Un sidecar estructurado alineado con el catálogo contiene la metadata muscular: 932 ejercicios se emparejan por ID normalizado
  con `hasaneyldrm/exercises-dataset` y 30 IDs locales tienen una asignación curada explícita. La
  UI no parsea el texto español visible de `musculo`.
- Un filtro de series duras (RIR 0–2) aparece únicamente si al menos tres series y el 50% del
  período tienen RIR. La distribución nunca se presenta como fatiga, recuperación o activación
  médica.
- El componente, la metadata y la geometría MIT frente/espalda se importan dinámicamente desde
  Historial. El render inicial y las rutas de entrenamiento no cargan ese bloque.
- La lista textual y el SVG consumen el mismo cálculo. El SVG usa una única silueta anatómica sin
  personalización por sexo o género, ofrece frente y espalda, navegación por teclado y estado
  seleccionado que no depende sólo del color.

## Placas de tablero (logros)

- Una placa es una **derivación pura** sobre `HistorialResumen` (`src/lib/placas.ts`), nunca un
  contador persistido. Marcar y desmarcar series devuelve exactamente las mismas placas: la regla
  "ir y venir no acumula" se cumple por construcción, sin código anti-repetición.
- No se guarda "ya la celebré". Cada placa ganada lleva `ganadaEl`, la fecha de la sesión que la
  ganó, y el cierre del día celebra sólo las de la fecha que se cierra. Corregir el pasado desde el
  historial puede hacer aparecer una placa en la lista, pero nunca dispara una celebración.
- Cada escalera tiene a lo sumo una placa en curso: la siguiente que falta. Los estados son los
  tres de una fila de serie (falta / en curso / ganada) y la fila es una sola (`PlacaFila.svelte`)
  para Historial y para el resumen de "Terminar día".
- La celebración de una placa se engancha al cierre del día, que ya es el momento de mayor
  recompensa: sin aviso, sonido ni vibración propios. La intensidad de la fiesta (fanfarria,
  halo, partículas, sin cierre automático) sigue a "día completo **o** placa ganada"; el texto
  del resumen sigue al veredicto del día. El cierre lee el historial antes de abrir el resumen
  para elegir el sonido con la placa en la mano.
- Familias definidas: Constancia (racha semanal 4/13/26/52 y días completos 10/50/100, verde de
  día terminado), y pendientes Carga, Marca, Oficio y Cuerpo. Sólo Cuerpo puede usar los colores de
  grupo muscular; las demás toman un color semántico de la app.
