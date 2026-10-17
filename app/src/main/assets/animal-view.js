import * as T from "./vendor/three.module.js";
// Low-contrast pixel clusters follow each moving body part at 32 texels/metre.
// Instanced dimensions preserve density on both large intact parts and wound cells.
export function animalMaterial() {
  const material = new T.MeshStandardMaterial({ roughness: 0.9 });
  material.onBeforeCompile = (shader) => {
    shader.vertexShader =
      "varying vec3 vCoatPosition; varying vec3 vCoatNormal;\n" +
      shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace(
      "#include <begin_vertex>",
      `#include <begin_vertex>
      vCoatPosition = position;
      #ifdef USE_INSTANCING
        vCoatPosition *= vec3(length(instanceMatrix[0].xyz),length(instanceMatrix[1].xyz),length(instanceMatrix[2].xyz));
      #endif
      vCoatNormal = normal;
    `,
    );
    shader.fragmentShader =
      "varying vec3 vCoatPosition; varying vec3 vCoatNormal;\n" +
      shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <map_fragment>",
      `#include <map_fragment>
      vec3 n=abs(vCoatNormal);
      vec2 uv=n.y>.5?vCoatPosition.xz:(n.x>.5?vCoatPosition.zy:vCoatPosition.xy);
      vec2 pixel=mod(floor(uv*32.0+.01)+32.0,8.0);
      float stroke=(pixel.x==2.0&&pixel.y>=2.0&&pixel.y<=4.0)||(pixel.x==6.0&&pixel.y==6.0)?1.0:0.0;
      float highlight=pixel.x==3.0&&pixel.y==4.0?1.0:0.0;
      diffuseColor.rgb *= 1.0-stroke*.11+highlight*.045;
    `,
    );
  };
  material.customProgramCacheKey = () => "feral-coat-32-v1";
  return material;
}
