// The camera orbits a ground target. The inverse projection uses the same lens
// and camera basis as the vertex shader, including the off-center framing.
export const focalLength = 1 / Math.tan((48 * Math.PI) / 360);
export class OrbitCamera {
  x = 18;
  z = 18;
  angle = 0.68;
  pitch = 0.65;
  zoom = 1;
  offset = 0;
  distance = 35;
  tilt(delta: number) {
    this.pitch = Math.max(0.19, Math.min(1.48, this.pitch + delta));
  }
  ground(u: number, v: number, aspect: number) {
    const across = (u * aspect) / focalLength;
    const up = (v - this.offset) / focalLength;
    const sin = Math.sin(this.pitch),
      cos = Math.cos(this.pitch);
    const down = sin - up * cos;
    if (down <= 0) return null;
    const t = (this.distance * sin) / down;
    if (t > 250) return null;
    const right = across * t,
      forward = this.distance * cos - t * (cos + up * sin);
    return {
      x: this.x + right * Math.cos(this.angle) + forward * Math.sin(this.angle),
      z: this.z - right * Math.sin(this.angle) + forward * Math.cos(this.angle),
    };
  }
}
