// CommonJS — Jest's default transform runs as CommonJS.
// ESM `export default {}` fails to parse when CSS imports chain
// through components like VideoPlayer (which imports `video.js/dist/video-js.css`).
module.exports = {};
