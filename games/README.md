# Juegos

Cartuchos `.v32` de Vircon32 hechos por la comunidad, para probar el emulador. Los cartuchos no están en el repositorio, porque son obra de sus autores, cada uno con su licencia, y ocupan unos 2 GB. Para descargarlos:

```bash
npm run games                 # todos
node games/download.mjs doom  # solo los que contienen "doom" en el nombre
```

[games.json](games.json) tiene, para cada cartucho, el título, el tamaño, el SHA-256 y la URL de descarga. El script no vuelve a descargar los que ya están y comprueba el SHA-256 de cada archivo.

## De dónde salen

La lista se hizo juntando, sin duplicados, los juegos de:

- [vircon32.joyrider3774.xyz](https://vircon32.joyrider3774.xyz/), de donde se descargan todos menos uno.
- Los juegos enlazados en [vircon32.com](https://www.vircon32.com/games-es.html), en GitHub ([vircon32/CommunityContent](https://github.com/vircon32/CommunityContent), [vircon32/ConsoleSoftware](https://github.com/vircon32/ConsoleSoftware) y los repos de cada autor) y en Google Drive. Todos estaban ya en la lista anterior salvo `AsteroidsV32.v32`, que en CommunityContent tiene una versión más nueva.

Para quitar duplicados se comparó el SHA-256 de los archivos. Si dos fuentes tenían un cartucho con el mismo título, se dejó la versión más nueva.

Los derechos de cada juego son de sus autores. Para los créditos y las licencias, mira la página o el repositorio de cada uno.
