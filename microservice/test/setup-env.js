// Test environment pin. Import this FIRST in any test file that (transitively)
// imports src/server.js: server.js loads <SPARKY_DATA_DIR>/microservice.env on
// import, and a developer's real env file (live BRIDGE_TOKEN, PLC_MODE=real)
// would otherwise leak into the tests. dotenv never overrides keys that are
// already set, so presetting them here wins.
process.env.PLC_MODE = "sim";
process.env.BRIDGE_TOKEN = ""; // empty disables bridgeAuth, as tests expect
