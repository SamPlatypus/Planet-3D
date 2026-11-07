# Data sources and third-party software

Planet 3D bundles everything it needs; nothing is fetched at run time.

| What | Source | Terms |
| --- | --- | --- |
| Planet orbits | E. M. Standish, *Keplerian Elements for Approximate Positions of the Major Planets*, JPL Solar System Dynamics | Public domain (U.S. Government work) |
| Physical data (radius, mass, gravity, rotation, tilt, temperature) | NASA Planetary Fact Sheets (NSSDCA) | Public domain (U.S. Government work) |
| Rotation-pole directions | IAU Working Group on Cartographic Coordinates and Rotational Elements (Archinal et al. 2018) | Published scientific data |
| Moon orbits | JPL planetary satellite mean elements; J. H. Lieske (1998) E5 theory for the Galilean moons' epoch longitudes | Published scientific data |
| Stars (positions, magnitudes, colours) | *The Bright Star Catalogue*, 5th revised ed., D. Hoffleit & W. H. Warren Jr. (1991), Yale University Observatory, via NASA ADC / CDS (V/50), as packaged by the Star Sky project | Free to use with acknowledgement |
| Galactic pole and centre | IAU (1958) galactic coordinate system, J2000 values | Published scientific data |

Software:

- [three.js](https://threejs.org), MIT licence, © 2010–2026 three.js authors.
- [Capacitor](https://capacitorjs.com) (`@capacitor/core`, `@capacitor/android`, `@capacitor/app`), MIT licence, © Ionic.
- The GLSL simplex noise in `src/render/glsl/noise.js` follows *webgl-noise* by Ian McEwan,
  Ashima Arts and Stefan Gustavson (MIT licence, text below).
- Development only (not shipped): [Vite](https://vite.dev) (MIT),
  [astronomy-engine](https://github.com/cosinekitty/astronomy) (MIT, the test suite's reference
  ephemeris), [Playwright](https://playwright.dev) (Apache-2.0, end-to-end tests and icon rendering).

All planet, moon and sky textures and the app icons are generated procedurally by this project.

---

## webgl-noise licence

```
Copyright (C) 2011 by Ashima Arts (Simplex noise)
Copyright (C) 2011-2016 by Stefan Gustavson (Classic noise and others)

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
```
