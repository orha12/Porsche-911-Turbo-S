# 911 Turbo S Open Road

A browser game where you drive a 911 Turbo S (992) through a six kilometre open world.
Everything is generated in code: the car model, the landscape and the engine sound.

## Play

Open `index.html` in a desktop browser (Chrome, Edge, Firefox or Safari). No install and no build step.
If your browser blocks local files, run `python3 -m http.server` in this folder and open `http://localhost:8000`.

## Controls

| Key | Action |
| --- | --- |
| W A S D or arrow keys | Throttle, brake and reverse, steering |
| Space | Handbrake |
| W + S at standstill | Launch control, release S to launch |
| C | Camera: chase, far chase, driver, showroom |
| Mouse drag | Look around the car |
| P | Next paint colour |
| L | Headlights |
| G | Manual gearbox (Q down, E up) |
| R | Back to the runway |
| M | Mute |
| V | Visual effects on or off |
| H | Hide the key list |

Phones and tablets get on-screen buttons.

## What is in it

- **The car**: procedural 911 Turbo S body with the fastback roofline, wide rear hips, side intakes, rear wing,
  full-width light bar, quad exhausts, dark multi-spoke wheels, yellow ceramic brake calipers, gloss black roof
  and vaned front intakes. Shark Blue by default, eight paint colours.
- **Driving model**: 478 kW and 800 Nm torque curve with turbo lag, 8-speed PDK ratios, all-wheel drive,
  1640 kg with the weight over the rear axle, tyre slip, load transfer and stability control.
  Measured in game: 0 to 100 km/h in about 2.75 s, 0 to 200 km/h in about 8 s, roughly 325 km/h flat out.
- **Sound**: a synthesised twin-turbo flat-six built with the Web Audio API. Engine note follows revs and throttle,
  with turbo whistle, blow-off on lift, overrun crackle, shift cuts, wind, road roar and tyre squeal.
- **World**: a 2.6 km runway for top speed runs, a ring highway, two mountain roads, a back road, a city grid,
  rolling hills, forests and a mountain rim. Buildings and trees are solid.

## Files

- `index.html` page, HUD and styles
- `src/car.js` car model
- `src/world.js` terrain, roads, city, scenery, sky
- `src/audio.js` engine and environment sound
- `src/post.js` bloom, speed blur, tone mapping
- `src/main.js` physics, cameras, input, HUD
- `vendor/three.min.js` three.js r149 (MIT licence)

Unofficial fan project. Not affiliated with or endorsed by Porsche AG.
