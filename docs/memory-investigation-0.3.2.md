# Investigación de memoria: Excalidraw / REA 0.3.2

## Evidencia y diagnóstico

El log de producción registra cierre no intencional a los 24 436 ms con un presupuesto de 300 000 ms y `stderrBytes=6728; stderrCategories=out-of-memory`. No corresponde a una expiración del presupuesto. El clasificador anterior reconoce `heap out of memory` o simplemente `allocation failed`: no conserva el texto original. No se puede reconstruir retroactivamente la firma fatal, el heap máximo, RSS, señal de salida ni el punto de asignación a partir de ese resumen. **El mecanismo exacto del incidente de Excalidraw sigue sin confirmarse.** No atribuirlo a V8, al sistema operativo o a una fuga sin más evidencia.

La nueva categoría `v8-fatal-heap-exhaustion` requiere una línea `FATAL ERROR:` con una firma de agotamiento de heap de V8. Su aparición confirma esa firma en stderr; no identifica la asignación culpable. Se conserva la categoría genérica y el cierre sigue visible. Solo se guardan categorías fijas y una cola de 512 caracteres, sin publicar fuentes, rutas o URLs. El cierre identifica también la operación en curso, sin esperar a que termine.

## Lanzamiento revisado

`src/mcp/client.ts` usa `StdioClientTransport({command,args,stderr:'pipe',maxBufferSize:64 MiB})`. La ruta normal entrega el Node seleccionado y `[scriptPath,'mcp']`; no añade opciones de heap ni hereda `process.execArgv`. El SDK instalado 1.32.1 usa `cross-spawn`, `shell:false`, tres pipes y un entorno permitido por lista. `NODE_OPTIONS` no está en esa lista y la extensión no proporciona `env`. Por tanto, un ajuste de `NODE_OPTIONS` en el host no configura este subproceso. Los 64 MiB limitan el buffer del transporte, no el heap del motor ni las asignaciones de JSON ya decodificado.

Es técnicamente posible pasar un argumento de Node antes de la ruta del script. Sería específico de un lanzamiento Node verificado; no puede aplicarse a cualquier wrapper. Elevar old-space no limita RSS, buffers, memoria nativa ni la complejidad del AST. No se implementó ese ajuste: no hay medida del incidente que justifique un valor y podría trasladar la presión de memoria al sistema. No se cambiaron rutas ni configuración MCP de Codex.

## Revisión del motor instalado (solo lectura)

Se inspeccionó el directorio local del motor REA, incluidos los archivos fuente y el parser compilado:

- `src/browser/CdpPageCaptureScripts.ts`: recorre todos los scripts observados; solicita `Debugger.getScriptSource` completo y acumula fuentes en el inventario. No se encontró presupuesto por script o agregado en esa ruta.
- `src/browser/CdpBrowserProvider.ts`, `analyzeBundle`: conserva `captured.inspection` durante el análisis; captura de nuevo, independientemente de la inspección previa de la extensión.
- `src/domain/webBundleAnalyzer.ts`: analiza scripts secuencialmente. No construye todos los AST simultáneamente de forma explícita, pero mantiene el inventario de fuentes y el acumulador de hallazgos.
- `src/domain/webBundleAnalyzerInspection.ts`: crea un AST completo, índices de bindings/receptores y hechos de mutación; recorre el AST y acumula hallazgos. No se encontró presupuesto de nodos o memoria en esa entrada. Eso demuestra una ruta de amplificación, no una fuga confirmada.
- `src/domain/browserObservation.ts`: el contrato estricto no ofrece parámetros para limitar bytes, scripts o nodos. El análisis requiere fuentes. Deshabilitar source maps (ya aplicado) no elimina el coste del AST.

La extensión recibe resultados después del trabajo del motor; sus límites de presentación y evidencia no evitan asignaciones dentro de REA. La mejora implementada actúa antes de solicitar fuentes para el análisis automático.

## Medición aislada

Prueba local del parser compilado `dist/domain/javascript/javascriptSourceParser.js`, Node v26.8.1, cada muestra en un proceso nuevo con `--max-old-space-size=256`. Se redujo el heap únicamente para esta prueba sintética, sin tocar lanzamientos existentes. Fuente repetida: `a.b("/api/example");\n`. Sin red, sin ejecutar el código fuente, sin alterar el motor.

| Sentencias | Bytes de fuente | Heap usado antes / después | RSS después | RSS máximo (KiB) |
| --- | ---: | ---: | ---: | ---: |
| 10 000 | 210 000 | 7 666 840 / 30 340 552 | 108 019 712 | 105 488 |
| 30 000 | 630 000 | 7 679 616 / 62 186 800 | 171 606 016 | 167 584 |

Medidas de `process.memoryUsage()` y `process.resourceUsage()`. Son snapshots y máximo RSS del proceso, no un perfil de asignaciones ni medidas del análisis completo. El parser por sí solo amplifica considerablemente el tamaño de fuente. El heap máximo comunicado en esas pruebas fue 369 098 752 bytes; el Node local sin opciones comunica 4 395 630 592 bytes. Ninguno establece el límite del proceso que falló en producción. No se reprodujo el incidente de Excalidraw ni se obtuvieron sus fuentes o una traza de memoria histórica.

## Corrección y alcance

La admisión del flujo automático exige un inventario completo con tamaños enteros conocidos: máximo 100 scripts, 500 000 caracteres por script y 2 000 000 agregados. Son umbrales conservadores de política, no valores obtenidos del punto de fallo ni una garantía de memoria. Se comprueban antes de `analyze_web_bundle`. Se conserva página/captura y se informa de resultado parcial y motivo explícito cuando se omite el análisis. El inventario sin fuentes sigue pudiendo consumir memoria dentro de REA.

Hay una carrera: la página puede cargar scripts adicionales entre inspección y análisis, y los tamaños son declarados por el productor. Los umbrales no pueden acotar de forma estricta el consumo interno. Las invocaciones manuales del catálogo y los otros clientes MCP no pasan por este filtro. Para límites reales el motor necesita presupuestos de captura antes de obtener fuentes, validación del tamaño recibido y límites del parser/índices, preferiblemente con aislamiento del trabajo pesado. Esa modificación corresponde a REA y no se realizó.

## Validación y distribución

Se añadieron regresiones de tamaños desconocidos, límite individual/agregado, número de scripts, retención de captura/página al omitir análisis y diferenciación de una firma fatal frente a una pista genérica. `npm run check` y `npm run build` finalizaron correctamente. `npm test`: 170 pruebas aprobadas, 2 omitidas (integración real opcional). Tras el último ajuste de presentación se repitieron las 32 pruebas de presupuesto, diagnóstico y flujo web, todas aprobadas.

El filtro es una corrección funcional que puede justificar un VSIX actualizado como mitigación de admisión, sin anunciar que repara el motor o confirma la causa de Excalidraw. No se empaquetó, publicó ni realizó commit.
