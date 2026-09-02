const { parentPort } = require('worker_threads');
const { selectModelParameters } = require('./shot-predictions');

if (!parentPort) {
  throw new Error('Il worker del modello deve essere avviato tramite worker_threads.');
}

parentPort.once('message', ({ observations }) => {
  try {
    const result = selectModelParameters(observations);
    parentPort.postMessage({ ok: true, result });
  } catch (error) {
    parentPort.postMessage({
      ok: false,
      error: {
        message: error.message || 'Errore durante il backtest del modello.',
        statusCode: error.statusCode,
        code: error.code,
      },
    });
  }
});
