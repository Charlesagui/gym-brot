# Roadmap — la calculadora de discos al lenguaje visual

> **Estado (2026-08-25):** fases 1 a 4 implementadas, más las tres mejoras de la segunda
> tanda (ver el final). La fase 5 se descartó por decisión del usuario: la calculadora
> sigue siendo autónoma y no se entera de la sesión.

## Por qué existe este documento

La pantalla de discos se escribió en `7a889fe` y no se volvió a tocar. El lenguaje visual
del manifiesto llegó después, en `581d8dd` (cifras y tres niveles de superficie), `6a05bb2`
(íconos propios), `b65c5bc` y `e213cef`/`0c32cc8` (foco, relieve y rótulos). Discos quedó
del lado viejo de esa línea: es la única pantalla operativa que no usa `.cifra`, ni
`.gb-relieve`, ni `.gb-foco`, ni un solo `Icono`.

No está rota ni fea por accidente: está escrita en el dialecto anterior.

## Auditoría contra el manifiesto

### 1. Ninguna cifra usa la tipografía de cifras

Manifiesto: _"Una cifra manda por pantalla, y va en la tipografía de cifras (`.cifra`)."_

Todo número de la pantalla se imprime en `system-ui` con `font-extrabold`:

- [+page.svelte:219](src/routes/herramientas/discos/+page.svelte:219) — el peso por lado,
  que es el resultado, va en `text-3xl font-extrabold tabular-nums`.
- [+page.svelte:220](src/routes/herramientas/discos/+page.svelte:220) — la unidad va en un
  `<span class="text-sm">` en vez de `.cifra-u`.
- [+page.svelte:235](src/routes/herramientas/discos/+page.svelte:235) y
  [:246](src/routes/herramientas/discos/+page.svelte:246) — los totales cercanos, igual.
- El `Stepper` del objetivo se instancia sin `grande`, así que su número sale en
  `text-base font-bold`, no en `.cifra`.

### 2. No hay una cifra que mande

El resultado exacto llega a 1,875 rem. En la pantalla de la serie, la cifra que manda va
entre 3,4 rem y 5,5 rem (`+page.svelte:1645`, `RestFocusOverlay.svelte`). Y cuando no hay
carga exacta —el caso más frecuente con discos incompletos— no hay ninguna cifra dominante:
quedan dos tarjetas de 1,25 rem compitiendo una al lado de la otra.

El objetivo y el resultado tampoco están jerarquizados entre sí: el que ingresás es chico y
el que leés es mediano.

### 3. Ningún control tiene relieve

Manifiesto: _"Un control grande tiene que verse apretable, no pintado: bisel arriba y
sombra abajo (`.gb-relieve`)."_

Las tres barras, el campo "Otra" y los siete discos son rectángulos pintados: borde de
1 px y relleno translúcido. No hay un solo `.gb-relieve` en el archivo.

### 4. Los targets se quedan en 44 px

Manifiesto: _"56 px como mínimo en lo que se toca entre repeticiones."_

`min-h-11` (44 px) en las barras
([:270](src/routes/herramientas/discos/+page.svelte:270)), en el campo "Otra"
([:284](src/routes/herramientas/discos/+page.svelte:284)) y en los discos
([:298](src/routes/herramientas/discos/+page.svelte:298)). El `Stepper` sin `grande` deja
sus ± en `min-h-11 w-11`.

Discos es exactamente una pantalla de entre-repeticiones: se abre parado frente al rack,
con las manos sudadas, para saber qué colgar. Es el peor lugar para 44 px.

### 5. El glow va hardcodeado

[+page.svelte:175](src/routes/herramientas/discos/+page.svelte:175) pasa
`glow="124 92 255"`, que es el valor de `--glow` copiado a mano. Si el token cambia, esta
pantalla queda con el color viejo. `EditarSerieSheet` ya demuestra que el prop acepta una
`var()`: pasa `glow="var(--max)"`.

(La misma copia literal está en `ajustes/+page.svelte:533`; se arregla junto o no se
arregla.)

### 6. Cero íconos, incluido donde el resto de la app sí los pone

Manifiesto: _"los íconos son SVG de trazo (`Icono.svelte`)."_

No hay violación por emoji —no hay ninguno—, pero sí una inconsistencia: el aviso
"La barra supera el peso total"
([:196](src/routes/herramientas/discos/+page.svelte:196)) es el único aviso naranja de la
app sin `Icono nombre="aviso"` al lado. Comparar con `ajustes/+page.svelte:788` y
`RestBar.svelte:73`.

### 7. La respuesta se da en texto, no en la pila de discos

Es el hallazgo más grande. La pregunta que la herramienta contesta es física —qué discos
cuelgo de cada lado— y la respuesta se entrega como una cadena: `2×20 + 10 + 2,5`. Hay que
leerla y traducirla.

La estética declarada es la de un tablero de máquina, y el token `--max` ya está definido
como _"tope de la pila de placas"_: el vocabulario de placas apiladas ya existe en el
sistema, sin usarse acá.

### 8. La combinación se trunca justo donde importa

[:238](src/routes/herramientas/discos/+page.svelte:238) y
[:249](src/routes/herramientas/discos/+page.svelte:249) aplican `truncate` a la lista de
discos, dentro de un `grid-cols-2` en un teléfono de 375 px. Una combinación de cuatro
términos se corta con puntos suspensivos: la herramienta esconde precisamente el dato por
el que existe.

### 9. Rótulos que no siguen la regla

Manifiesto: _"Los botones llevan verbos y los estados van en los rótulos."_

- [:262](src/routes/herramientas/discos/+page.svelte:262) — "Tocá una o escribí otra" es
  una instrucción de 10 px, no un rótulo. Un control que se ve apretable no la necesita.
- El estado apagado de un disco se comunica solo con `opacity: .55`
  ([:301](src/routes/herramientas/discos/+page.svelte:301)). Eso se lee "deshabilitado", no
  "no tengo ese disco".

### 10. Una sola superficie donde el sistema tiene tres

Desde `581d8dd` hay `--surface`, `--surface-2`, `--surface-3` y `.gb-foco`. La pantalla usa
`var(--surface)` para las cuatro tarjetas y después inventa `bg-white/[0.045]` y
`bg-white/[0.035]` a mano. El resultado —lo único que fuiste a buscar— tiene exactamente el
mismo peso visual que la grilla de discos disponibles, que es configuración que tocás una
vez por gimnasio.

### 11. El chip de unidad ocupa el mejor lugar del header

[:163](src/routes/herramientas/discos/+page.svelte:163) pone `kg` arriba a la derecha. No
es accionable —la unidad se cambia en Ajustes— y ocupa la esquina que en el resto de la app
lleva una acción.

### Lo que sí cumple

- Usa `Stepper` y no `RuedaTiempo` para el peso. El manifiesto es explícito: la rueda es
  para rangos cortos de paso grueso, no para valores exactos. Está bien resuelto.
- El acuse de presión funciona sin marcar nada: la primitiva de `app.css` cubre todo
  `button` por defecto.
- `aria-pressed`, `aria-live` en el resultado y `aria-label` en cada control: la capa de
  accesibilidad está mejor que la visual.
- El cálculo (`src/lib/discos.ts`) es puro, exacto en centésimas y está testeado. Nada de
  este roadmap lo toca.

## Roadmap

Cinco fases, ordenadas por relación entre lo que se gana y lo que se rompe. Cada una deja
la pantalla en un estado entregable.

### Fase 1 — Hablar el idioma de las cifras — hecha

Sin cambios de layout. Es el piso del que dependen las demás.

- `.cifra` + `.cifra-u` en el peso por lado, en los dos totales cercanos y en la
  combinación.
- `Stepper` con `grande` y `unidad={unidad}` para el objetivo: sus ± pasan a 56 px y su
  número a `.cifra`.
- `glow="var(--glow)"` en vez del triplete literal, acá y en `ajustes/+page.svelte:533`.
- `min-h-14` en barras, discos y campo "Otra".

**Criterio:** ningún número de la pantalla queda en `font-extrabold` de `system-ui`, y no
queda ningún target por debajo de 56 px.

### Fase 2 — Jerarquía de una sola cifra — hecha

- La tarjeta de resultado sube a `--surface-3` con `.gb-foco`: es lo que estás haciendo
  ahora, y es lo único abierto.
- El peso por lado va a `text-[3.4rem]`, alineado con el PR de la pantalla de ejercicio.
- El caso sin carga exacta deja de ser dos tarjetas gemelas: la opción más cercana al
  objetivo es la cifra que manda, y la otra queda como alternativa secundaria debajo.
- Se saca `truncate`: la combinación se muestra entera, envolviendo si hace falta.
- El objetivo y la grilla de configuración bajan a `--surface` y `--surface-2`.

**Criterio:** de lejos, una sola cifra se lee primero, y ninguna combinación queda cortada.

### Fase 3 — La barra dibujada — hecha

El corazón del rediseño. Un componente nuevo, `BarraCargada.svelte`, que dibuja la barra
con sus discos por lado en SVG.

- Cada disco es una placa vertical: alto proporcional a su peso, ancho fijo, ordenadas de
  mayor a menor desde el centro. Es la pila de placas del tablero de máquina.
- El peso va escrito sobre la placa cuando entra; si no, se apoya en la lista de texto, que
  sigue estando.
- El color: acento para la carga, `--max` para el disco más pesado disponible cuando la
  pila llega al tope. Estructura, no decoración.
- Es puro y determinístico: consume el `CargaBarra` que ya devuelve `calcularDiscos`, sin
  lógica propia. Testeable como los demás componentes.
- Respeta `prefers-reduced-motion`: sin animación de entrada si está activo.

**Criterio:** se puede saber qué colgar sin leer una sola palabra.

### Fase 4 — Relieve y rótulos — hecha

- `.gb-relieve` en las barras, los discos y el campo "Otra": la grilla deja de parecer
  pintada.
- El estado apagado de un disco deja de ser `opacity: .55` y pasa a una placa vacía —
  contorno sin relleno—, que se lee "no lo tengo" y no "no anda".
- Se saca "Tocá una o escribí otra".
- `Icono nombre="aviso"` en el aviso de barra que supera el objetivo, como el resto de la
  app.
- El chip de unidad sale del header o se vuelve un enlace a Ajustes, que es donde se
  cambia.

**Criterio:** cada control se ve apretable, y ningún rótulo explica lo que la forma ya
dice.

### Fase 5 — Que la herramienta sepa dónde estás — descartada

Proponía prellenar el objetivo con el peso de la serie en curso y devolver el total armado
a la serie. **Se descartó**: acoplar la calculadora a la sesión complica una herramienta que
hoy funciona sola, sin sesión abierta, y que se entiende sin explicación.

La calculadora sigue siendo autónoma. Si en algún momento el prellenado se vuelve una
molestia real —tipear el mismo peso que ya está en pantalla—, el punto de partida es este.

## Lo que no se toca

- `src/lib/discos.ts` y sus tests. El cálculo está bien y es la parte más sólida de la
  pantalla.
- La persistencia por unidad en `localStorage`, con su validación de entrada.
- El `Stepper` como control del objetivo: la rueda sería un error acá, por manifiesto.

## Lo que quedó implementado

- `src/lib/components/BarraCargada.svelte` — nuevo. Dibuja un lado de la barra en SVG a
  partir del `CargaBarra` que ya devuelve `calcularDiscos`. Alto de placa por raíz cuadrada
  del peso (los discos reales no crecen en proporción), `--max` en la placa que iguala al
  disco más grande disponible, y entrada escalonada que `prefers-reduced-motion` apaga desde
  `app.css`. Va `aria-hidden`: la lista de discos de al lado dice lo mismo, mejor dicho, y
  el bloque entero es un `aria-live`.
- `src/routes/herramientas/discos/+page.svelte` — cifras en `.cifra`/`.cifra-u`, `Stepper`
  en modo `grande`, resultado en `.gb-foco` (canto verde si la carga es exacta, glow si es
  aproximada), una sola cifra por caso, relieve y 56 px en todo lo tocable, disco ausente
  como ranura punteada, `Icono` en el aviso y el chip de unidad como enlace a Ajustes.
- `src/routes/ajustes/+page.svelte` — el `glow` de `RuedaTiempo` deja de ser el triplete
  literal `124 92 255` y pasa a `var(--glow)`.
- `e2e/discos.spec.ts` — cubre la cifra que manda, la lista de discos y la alternativa.

Los fallbacks `?? '124 92 255'` que quedan en el código son valores por defecto de color de
grupo muscular en TypeScript, no props de estilo: son otro problema y no se tocaron.

## Segunda tanda — la barra entera, el color y el barrido

Tres pedidos posteriores, con su informe de factibilidad previo. Los tres implementados.

### La barra se dibuja entera

Se muestran los dos lados. Es información redundante —el cálculo es simétrico y el lado
derecho nunca dice nada nuevo— y se hace igual: el error clásico de matemática de discos es
cargar un solo lado, y con media barra esquivarlo depende de que leas el rótulo "por lado".

No cuesta legibilidad. El dibujo se escala para entrar en su caja y, mientras lo limite el
alto y no el ancho, duplicarlo no cambia nada: hasta 8 discos por lado el número de la placa
queda en los mismos 8,2 px. Recién a 10 baja a 6,8, y las cargas reales usan entre 1 y 4
discos por lado (200 kg son 4).

Dos correcciones posteriores, las dos por lo mismo: el dibujo tenía que parecerse más a una
barra.

- **Ancho mínimo de 320 en el `viewBox`, y la caja a `h-28`.** `meet` escala para que entre
  entero, así que con pocos discos el recuadro quedaba casi cuadrado y el dibujo usaba el
  34% del ancho de la tarjeta en un teléfono de 375, y el 29% en uno de 430. Con la
  proporción fijada en 3,2:1 queda entre 98% y 100% en las tres medidas, y el número de la
  placa crece de 8,2 a 9,5 px en los teléfonos grandes en vez de achicarse.
- **El sobrante se lo lleva el eje, no las puntas.** Con el eje fijo y corto, los discos
  quedaban amontonados contra el centro con media barra vacía por fuera — exactamente lo
  contrario de una barra cargada. Ahora cada lado ocupa lo suyo contra la punta y el medio
  estira: con dos discos por lado el eje queda en 64% del largo, contra el 60% de una barra
  olímpica real. Antes era 8%, sin importar la carga.

### Un color por peso

`src/lib/discos-color.ts`. Los discos reales vienen codificados por color —25 rojo, 20 azul,
15 amarillo, 10 verde, 5 blanco es el estándar de competición— y quien entrena lo tiene
incorporado. Reproducir esa codificación no decora: es la misma información que usás cuando
agarrás la placa del rack.

Lo que no se puede es copiar los colores tal cual. Están pensados para la luz del día sobre
una barra cromada, y esta app es casi negra: contra `--surface-3`, el azul real de 20 kg da
2,26:1 y el rojo de 25 se queda en 3,19:1. Se conserva el tono, que es lo que da el
reconocimiento, y se sube la luminosidad a la banda que la app ya usa para los grupos
musculares. El peor caso de la paleta queda en 5,76:1, y `discos-color.test.ts` lo verifica
en vez de confiar en que alguien lo mire.

Dos decisiones tomadas:

- **El 2,5 va rosa.** En la vida real es rojo, igual que el 25, porque la escala se repite en
  las fracciones. En el dibujo el tamaño los separa; en la grilla de disponibles no, y
  quedaban dos botones rojos iguales.
- **La marca naranja del tope de la pila se sacó.** Pasó por dos formas —aro por fuera de la
  placa, después canto naranja— y las dos ensuciaban el disco. La señal era débil de entrada:
  se prendía en casi toda carga, porque casi toda carga usa el disco más grande. Lo que quedó
  es el canto metálico en todas las placas: un degradado claro arriba y oscuro abajo, que es
  como se ve un borde mecanizado con la luz de arriba.

Las placas pasan de teñidas a llenas: a media opacidad los siete colores se acercan entre sí
hasta dejar de distinguirse. La tinta va oscura, que es para lo que existe `--on-bright`.

### El objetivo se pone con una cinta métrica

`CintaPeso.svelte`. El ± se fue de esta pantalla: el objetivo se elige arrastrando una regla
con marcas y números, con la aguja fija en el centro.

El primer intento fue un barrido escondido sobre la cifra, conservando el ±. No servía, y por
un motivo que vale anotar: **un gesto sin forma visible no existe**. Nadie va a descubrir que
la cifra se arrastra si nada en la pantalla lo insinúa. Una cinta se entiende porque se ve
que es una cinta.

La cinta sigue al dedo, como una cinta de verdad: llevarla a la derecha trae los números de
abajo, porque lo que corre es la cinta y no la aguja. La cifra salta de a pasos pero el
dibujo se mueve continuo — redondear también la cinta hace que el gesto se sienta trabado.

Sobre la regla del manifiesto (un toque le gana a cualquier gesto en el peso): se escribió
para el peso de una serie, donde el valor viene prellenado de la vez anterior y está a un
toque. El objetivo de la calculadora se explora, y ir de 60 a 100 kg con un ± son dieciséis
toques que además no te muestran nada de lo que hay en el medio.

Lo que no se pierde:

- **Escribirlo.** La cifra sigue siendo un campo: para saltar de 60 a 180 el teclado gana, y
  está a un toque. La cinta se acomoda sola al valor escrito.
- **El teclado y el lector de pantalla.** Es un `role="slider"` con flechas, PageUp/PageDown y
  Home/End, y `aria-valuetext` que dice el peso con su unidad.
- **El scroll.** `touch-action: pan-y` deja que el navegador se quede con el eje vertical, así
  que la página scrollea aunque el dedo caiga sobre la cinta.

### El rótulo de la grilla

"Discos por lado" se leía como _cuántos_ discos vas a usar, cuando la grilla es _qué pesos de
disco_ hay en el gimnasio. La cantidad la resuelve el cálculo. Pasó a "Pesos de disco que
tenés".

## Que entre en una pantalla

La pantalla medía 813 px contra 663 disponibles: se scrolleaba siempre. Se achicó todo en
lugar de esconder nada, que era la otra salida posible.

Lo primero era un bug, no un problema de diseño: la página reservaba `100dvh-4rem` para la
barra de navegación cuando el shell reserva `pb-20`, o sea 5rem. Ese desfasaje forzaba 16 px
de scroll por sí solo, sin importar el contenido. El resto de las rutas ya usaba 5rem; sólo
las de `herramientas/` estaban en 4.

Después, escala compacta pareja: cifras un escalón más chicas, padding de 3 a 2,5, la unidad
del objetivo plegada al rótulo ("Peso total en kg") en vez de ocupar su propia línea, y la
cinta de 4,25 a 3,25 rem con las marcas recolocadas.

Lo que más rindió fue pasar los siete discos disponibles de dos filas a una: 50 px por un
dato que se configura una vez por gimnasio. Los botones quedan de 42×44 px, por debajo de
los 56 del manifiesto, y está bien: esa regla es para lo que se toca _entre repeticiones_.
Lo que sí se opera —la cinta y la cifra— queda en 321×52 y 321×53.

Medido en los cuatro estados que cambian de alto (carga exacta, sin carga exacta, carga
grande, y sin carga exacta con pocos discos):

| Pantalla                                                | Entra                                          |
| ------------------------------------------------------- | ---------------------------------------------- |
| 727 px (Pixel 5 y la mayoría de los teléfonos actuales) | los cuatro estados                             |
| 667 px (iPhone SE / 8)                                  | tres de cuatro; sin carga exacta se pasa 46 px |
| 600 px                                                  | no entra                                       |

El estado sin carga exacta es el que más mide, porque suma la tarjeta de la alternativa.
Hacerlo entrar también en 667 pedía achicar el dibujo de la barra, que es justamente lo que
la pantalla vino a mostrar, así que ahí se deja scrollear.
