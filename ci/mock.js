// Sustituye Gemini y Piper por contenido/voz sintéticos para probar el render sin cuotas ni red.
module.exports = async page => {
  await page.addInitScript(() => {
    Object.defineProperty(window, '__studio', {
      configurable: true,
      set(api) {
        Object.defineProperty(window, '__studio', { value: api, writable: true, configurable: true });
        api.genScript = async index => {
          const topic = 'Prueba técnica de renderizado vertical';
          const narration = 'Un pequeño cambio en la forma de observar el mundo puede revelar detalles sorprendentes. Esta prueba local comprueba que narración, escenas, subtítulos y sonido se combinan correctamente en un vídeo vertical.';
          const script = api.autoScenes(narration, topic);
          script.titulo = 'Prueba técnica de renderizado';
          script.descripcion = 'Vídeo sintético de comprobación interna.';
          script.hashtags = ['prueba', 'shorts'];
          script.fuentes = [{ t: 'Fuente simulada', u: 'https://example.com' }];
          const slot = api.slots[index];
          slot.topic = topic;
          slot.script = script;
          slot.err = '';
          slot.busy = '';
          slot.pct = 0;
          return script;
        };
        Object.defineProperty(api, 'Voice', {
          configurable: true,
          set(voice) {
            Object.defineProperty(api, 'Voice', { value: voice, writable: true, configurable: true });
            voice.speak = async (text, settings) => api.TTS.speak(text.replace(/[*_#]/g, ''), { rate: settings.rate });
          }
        });
      }
    });
  });
};
