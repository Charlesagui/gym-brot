# Cola

Renglones sueltos para la rutina **Proto**. Un renglón por idea o pregunta.

La otra entrada de Proto (`docs/revisiones/DISENO.md`, en la rama `revisiones`)
se genera sola: son los casos en que la rutina de arreglo se abstuvo porque
había que elegir entre dos diseños, o porque tocaba el esquema de Dexie. Este
archivo es la puerta manual, para lo que se te ocurre a vos y el sistema no
puede descubrir solo.

**Cómo funciona:** agregás un renglón, commiteás a `test`. Proto corre a las
11:00 ART, agarra **uno** (primero lo de `DISENO.md`, después lo de acá, siempre
lo más viejo), construye lo necesario para poder comparar, y deja el resultado
en `docs/revisiones/PROTOTIPOS.md` de la rama `revisiones` con la decisión
pendiente. Lo ves con `/cola`.

Si la duda es visual, Proto saca capturas a 320 px y a un ancho normal: una
opción de UI descrita en palabras no se puede evaluar en una app que se usa con
una mano entre series.

Las líneas ya procesadas quedan registradas en `PROTOTIPOS.md`, así que no hace
falta borrarlas de acá — Proto no las vuelve a agarrar.

**Qué sirve escribir acá:** una duda que se contesta construyendo. "¿Conviene X
o Y?", "¿cuánto pesaría Z?", "¿se puede hacer esto en un toque en vez de tres?".
Proto no elige por vos: te devuelve las opciones con lo que cuesta cada una, en
código y en bytes contra el presupuesto.

**Qué no:** bugs (esos van por la auditoría, que los encuentra sola) y trabajo
definido que sólo hay que hacer (eso es una sesión normal, no un prototipo).

---

<!-- Un renglón por ítem. Ejemplo:
- ¿Se puede marcar una serie sin mirar la pantalla? ¿Cuánto costaría un gesto en vez del botón?
-->
