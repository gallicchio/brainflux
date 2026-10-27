// A helper thread: when every angle must be measured at once (a slider moved after a scan),
// the page splits the angles between a few of these, each measuring its block with its own
// copy of the scanner, and adds up their pictures.  Same code, same random numbers, so the
// result is the one the page would have computed alone, only sooner.

import { Scanner } from './scan.js';

let sc = null;

self.onmessage = ({ data: d }) => {
  if (!sc || sc.N !== d.N) sc = new Scanner(d.N);
  sc.configure(d.opts, false);
  sc.pass = d.pass;
  if (d.shapes) sc.setShapes(d.shapes, false); else sc.setPicture(d.picture);
  const b = sc.measureBlock(d.j0, d.j1);
  b.gen = d.gen;
  self.postMessage(b, [b.ideal.buffer, b.idealQ.buffer, b.meas.buffer, b.filt.buffer, b.specRe.buffer, b.specIm.buffer, b.bp.buffer, b.fbp.buffer]);
};
