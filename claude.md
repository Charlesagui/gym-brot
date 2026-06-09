# Gym-brot: manifiesto de producto

Gym-brot es una app personal de gimnasio, mobile-first y offline. Debe sentirse rápida
durante la serie, clara durante el descanso y celebratoria cuando hay logro.

## Principios

- La operación manda: registrar una serie debe requerir pocos toques y funcionar con una mano.
- Cada pantalla debe priorizar lo que el usuario necesita en el gym, no lo que queda lindo en abstracto.
- Los botones principales pueden ser grandes; las acciones secundarias deben ser discretas.
- La app debe explicar con estado visible lo que está pasando: series hechas, descanso activo,
  PR, ejercicio terminado y día terminado.
- Nada importante debe volver de forma abrupta si acaba de pasar un logro.

## Recompensas

- Un set hecho merece microfeedback.
- Un descanso terminado merece una señal útil y breve.
- Un PR merece una recompensa especial.
- Un ejercicio terminado merece una transición de éxito antes de volver al día.
- Un día terminado es el momento de mayor recompensa visual, sonora o háptica.
- La vibra puede inspirarse en Candy Crush por claridad y dopamina, pero con estética gym:
  breve, intensa, sobria y no infantil.

## Sonido, movimiento y accesibilidad

- Todo sonido debe poder apagarse.
- Las celebraciones deben respetar preferencias de menor movimiento cuando existan.
- La recompensa nunca debe bloquear el registro rápido por más de un momento corto.
- La vibración y el audio son capas opcionales: la interfaz visual debe funcionar sola.

## Datos y verdad

- Si la UI dice PR, debe quedar claro qué métrica está usando.
- Si el gráfico muestra progreso, debe representar datos reales y nombrar esa métrica.
- Diferenciar siempre entre series objetivo de la rutina y series hechas o agregadas en la sesión actual.

## Regla para agentes

Antes de modificar Gym-brot, leer este archivo y preservar estos principios salvo que el usuario
pida explícitamente cambiarlos.
