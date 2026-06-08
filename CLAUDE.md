# demo-director

Turns a built app into a narrated demo video: Playwright capture → vision-grounded
script → ElevenLabs VO → Remotion compose, with audio as the master timeline.

## Capture gotcha — WebGL

Headless browsers often have no WebGL; shader/3D content screenshots BLACK. When capturing
an app with WebGL/3D, use a headed/GPU browser and confirm `getContext('webgl2')` returns
non-null before trusting frames. A black capture of a 3D app is an environment failure, not
the app being broken.
