"""Run: blender -b -P tools/asset-pipeline/verify-blender.py -- <repository-root>"""
import bpy,sys,json,os,math
from mathutils import Vector
root=sys.argv[sys.argv.index('--')+1]
manifest=json.load(open(os.path.join(root,'design/assets/manifest.json')))
reports=[]
for entry in manifest['entries']:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=os.path.join(root,'design/assets',entry['glb']))
    points=[]
    for obj in bpy.context.scene.objects:
        if obj.type=='MESH':
            for co in obj.bound_box:
                v=obj.matrix_world @ Vector(co)
                # Blender importer converts Y-up glTF into Z-up Blender (x,y,z)->(x,-z,y).
                points.append((v.x,v.z,-v.y))
    lo=[min(v[i] for v in points) for i in range(3)]
    hi=[max(v[i] for v in points) for i in range(3)]
    err=max(abs(v-entry['bounds'][key][i]) for key,vec in [('min',lo),('max',hi)] for i,v in enumerate(vec))
    if err>0.0001:raise RuntimeError(entry['id']+' imported bounds differ '+str(err))
    reports.append({'id':entry['id'],'meshObjects':sum(o.type=='MESH' for o in bpy.context.scene.objects),'maxBoundsErrorM':err})
output={'ok':True,'blender':bpy.app.version_string,'count':len(reports),'reports':reports}
os.makedirs(os.path.join(root,'verification/visual-assets'),exist_ok=True)
json.dump(output,open(os.path.join(root,'verification/visual-assets/blender-import.json'),'w'),indent=2)
print('FERAL_IMPORT_OK',len(reports))
