// Runs on the audio thread: passes the microphone's raw samples to the page in batches.
// Recording raw audio this way avoids MediaRecorder, whose files Safari can't fully
// decode again (it only reads the first fragment of its own MP4 recordings).

class Capture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buf = new Float32Array(4096);
    this.len = 0;
    this.port.onmessage = () => {
      this.port.postMessage(this.buf.slice(0, this.len));
      this.len = 0;
      this.port.postMessage('done');
    };
  }

  process(inputs) {
    const ch = inputs[0]?.[0];
    if (ch) {
      if (this.len + ch.length > this.buf.length) {
        this.port.postMessage(this.buf.slice(0, this.len));
        this.len = 0;
      }
      this.buf.set(ch, this.len);
      this.len += ch.length;
    }
    return true;
  }
}

registerProcessor('capture', Capture);
