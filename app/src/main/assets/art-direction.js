import * as T from "./vendor/three.module.js";

// Original procedural materials. World-space sampling keeps greedy faces and half cells seamless.
export function terrainMaterial() {
  const material = new T.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.92,
    metalness: 0.02,
  });
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader.replace(
      "#include <common>",
      "#include <common>\nattribute float materialKind; varying float vKind; varying vec3 vCell; varying vec3 vFace;",
    );
    shader.vertexShader = shader.vertexShader.replace(
      "#include <begin_vertex>",
      "#include <begin_vertex>\nvCell=position; vFace=normal; vKind=materialKind;",
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <common>",
      `#include <common>
      varying float vKind; varying vec3 vCell; varying vec3 vFace;
      float grain(vec2 p) { return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
    `,
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <color_fragment>",
      `#include <color_fragment>
      vec3 face=abs(vFace);
      vec2 uv=face.y>.5?vCell.xz:(face.x>.5?vCell.zy:vCell.xy);
      vec2 pixel=floor(uv*16.0);
      float g=grain(pixel), coarse=grain(floor(uv*4.0));
      float textureShade=.88+g*.16+coarse*.08;
      vec2 tile=fract(uv);
      if(vKind<1.5) {
        if(face.y<.5) {
          float lip=.80+grain(vec2(floor(uv.x*8.0),floor(vCell.y)))*.12;
          diffuseColor.rgb=mix(vec3(.22,.135,.074),diffuseColor.rgb,step(lip,fract(vCell.y-.001)));
        } else textureShade=.84+coarse*.23+g*.09;
      } else if(vKind>4.5 && vKind<5.5) {
        float stripe=step(.68,grain(vec2(floor(uv.x*12.0),floor(uv.y*2.0))));
        textureShade=.8+g*.12+stripe*.24;
        if(face.y>.5) textureShade=.88+.13*sin(length(tile-.5)*48.0);
      } else if(vKind>10.5) {
        float seam=step(.94,fract(uv.y*4.0));
        textureShade=(.9+grain(vec2(pixel.x,floor(pixel.y/4.0)))*.15)*(1.0-seam*.25);
      } else if(vKind>2.5 && vKind<3.5 || vKind>7.5 && vKind<8.5) {
        float joint=step(.94,tile.y)*.12+step(.96,fract(uv.x+floor(uv.y)*.5))*.12;
        textureShade=.88+coarse*.16+g*.06-joint;
      } else if(vKind>6.5 && vKind<7.5) {
        float crystal=step(.67,coarse);
        diffuseColor.rgb=mix(vec3(.12,.18,.19),diffuseColor.rgb,crystal*.8+.2);
        textureShade=.9+g*.15;
      } else if(vKind>3.5 && vKind<4.5) textureShade=.92+g*.09+sin(floor(uv.y*8.0)+coarse)*.035;
      diffuseColor.rgb*=textureShade;
    `,
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <emissivemap_fragment>",
      "#include <emissivemap_fragment>\nif(vKind>6.5 && vKind<7.5) totalEmissiveRadiance+=vec3(.015,.055,.05)*step(.78,coarse);",
    );
  };
  return material;
}

export class Atmosphere {
  constructor(view) {
    this.view = view;
    this.uniforms = {
      top: { value: new T.Color(0x527f9c) },
      horizon: { value: new T.Color(0xc7d6c1) },
    };
    this.sky = new T.Mesh(
      new T.SphereGeometry(1, 24, 12),
      new T.ShaderMaterial({
        side: T.BackSide,
        depthWrite: false,
        depthTest: false,
        uniforms: this.uniforms,
        vertexShader:
          "varying vec3 direction; void main(){ direction=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }",
        fragmentShader:
          "uniform vec3 top; uniform vec3 horizon; varying vec3 direction; void main(){ float h=smoothstep(-.08,.8,normalize(direction).y); gl_FragColor=vec4(mix(horizon,top,h),1.0); #include <tonemapping_fragment>\n#include <colorspace_fragment>\n }".replace(
            "; #include",
            ";\n#include",
          ),
      }),
    );
    this.sky.frustumCulled = false;
    this.sky.renderOrder = -1000;
    view.scene.add(this.sky);
    this.waterTime = { value: 0 };
    view.waterMesh.material.onBeforeCompile = (s) => {
      s.uniforms.flowTime = this.waterTime;
      s.vertexShader = s.vertexShader.replace(
        "#include <common>",
        "#include <common>\nvarying vec3 vWater;",
      );
      s.vertexShader = s.vertexShader.replace(
        "#include <project_vertex>",
        "#include <project_vertex>\nvWater=(modelMatrix*instanceMatrix*vec4(transformed,1.0)).xyz;",
      );
      s.fragmentShader = s.fragmentShader.replace(
        "#include <common>",
        "#include <common>\nuniform float flowTime; varying vec3 vWater;",
      );
      s.fragmentShader = s.fragmentShader.replace(
        "#include <normal_fragment_begin>",
        "#include <normal_fragment_begin>\nnormal=normalize(normal+vec3(sin(vWater.x*2.5+flowTime*.8)*.10,0.0,cos(vWater.z*2.0+flowTime*.6)*.10));",
      );
      s.fragmentShader = s.fragmentShader.replace(
        "#include <color_fragment>",
        "#include <color_fragment>\nfloat ripple=sin(vWater.x*3.0+vWater.z*1.5+flowTime)*sin(vWater.z*2.0-flowTime*.7); diffuseColor.rgb*=.94+ripple*.06;",
      );
    };
    this.topDay = new T.Color(0x497d9e);
    this.horizonDay = new T.Color(0xc8d6c0);
    this.topNight = new T.Color(0x172638);
    this.horizonNight = new T.Color(0x53677b);
    this.sunColor = new T.Color(0xffe0b0);
    this.moonColor = new T.Color(0x98b6d8);
    this.fogColor = new T.Color();
  }
  update(time, day) {
    const v = this.view,
      cam = v.camera.position;
    const light = Math.max(0.08, Math.min(1, (day - 0.15) / 0.7));
    this.uniforms.top.value.copy(this.topNight).lerp(this.topDay, light);
    this.uniforms.horizon.value
      .copy(this.horizonNight)
      .lerp(this.horizonDay, light);
    this.fogColor.copy(this.uniforms.horizon.value);
    v.scene.fog.color.copy(this.fogColor);
    v.renderer.setClearColor(this.fogColor);
    this.sky.position.copy(cam);
    this.sky.scale.setScalar(v.camera.far * 0.9);
    v.ambientLight.intensity = 0.7 + light * 0.65;
    v.sunLight.intensity = 0.5 + light * 2.6;
    v.sunLight.color.copy(this.moonColor).lerp(this.sunColor, light);
    // Texel-snapped local shadow volume avoids a full-world high-resolution shadow map.
    const x = Math.round(cam.x * 8) / 8,
      z = Math.round(cam.z * 8) / 8,
      y = Math.round(cam.y * 4) / 4;
    v.sunLight.position.set(x - 35, y + 65, z + 28);
    v.sunLight.target.position.set(x, y - 5, z);
    v.sunLight.target.updateMatrixWorld();
    v.sun.position.set(cam.x - 35, cam.y + 55, cam.z + 28);
    v.sun.material.color.copy(this.sunColor);
    this.waterTime.value = time;
  }
}
