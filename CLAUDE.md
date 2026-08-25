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

## Lenguaje visual

La estética es la de un **tablero de máquina**: una cifra grande que manda, controles que se
ven apretables y todo lo demás en penumbra hasta que hace falta.

- Una cifra manda por pantalla, y va en la tipografía de cifras (`.cifra`). El peso, las reps,
  el descanso y el récord son el contenido de la app, no un rótulo más.
- Lo que estás haciendo es lo único abierto: la serie en curso se muestra entera y con relieve
  (`.gb-foco`), la hecha se contrae a lo que levantaste y la que falta se insinúa con su objetivo.
- Un control grande tiene que verse apretable, no pintado: bisel arriba y sombra abajo
  (`.gb-relieve`), y 56 px como mínimo en lo que se toca entre repeticiones.
- El color del grupo muscular estructura, no decora: canto de la fila activa, anillo del
  descanso, relleno del progreso.
- Los botones llevan verbos y los estados van en los rótulos: "Marcar hecha", no "Hecha".
- Cero emoji en la interfaz operativa: los íconos son SVG de trazo (`Icono.svelte`, 24×24,
  stroke-width 2, currentColor). El emoji queda para las celebraciones y para los seis grupos
  musculares del catálogo.
- Los controles rotatorios (`RuedaTiempo`) son para rangos cortos de paso grueso, como el
  descanso. No para valores exactos como el peso: ahí un solo toque le gana a cualquier gesto.

## Regla para agentes

Antes de modificar Gym-brot, leer este archivo y preservar estos principios salvo que el usuario
pida explícitamente cambiarlos.
