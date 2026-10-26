import json, subprocess, os
from slkutil import S
U=json.load(open('/home/claude/extract/json/units.json'))
src=open('/home/claude/game/src/gamedata.js').read(); D=json.loads(src[src.index('{'):src.rindex('}')+1])
AL=S('ui/soundinfo/animlookups.slk'); AS=S('ui/soundinfo/animsounds.slk'); UC=S('ui/soundinfo/unitcombatsounds.slk')
UA=S('ui/soundinfo/unitacksounds.slk'); UI=S('ui/soundinfo/uisounds.slk'); AB=S('ui/soundinfo/abilitysounds.slk')
codes=json.loads(subprocess.check_output(['node','-e','''
const fs=require('fs');const Model=require('/home/claude/web3d/node_modules/mdx-m3-viewer/dist/cjs/parsers/mdlx/model').default;
const files=require('child_process').execSync('find /home/claude/wc3data/files /home/claude/web3d/mapassets -name "*.mdx"').toString().trim().split('\\n');
const names=new Set(); for(const f of files){const m=new Model();m.load(fs.readFileSync(f)); for(const e of m.eventObjects) if(e.name.startsWith('SND')) names.add(e.name.slice(4,8));}
console.log(JSON.stringify([...names]));''']).decode())
sounds={}
def addlabel(tab,label,kind):
    r=tab.get(label)
    if not r: return False
    sounds[label]={'files':[ (r.get('directorybase') or '')+f.strip() for f in str(r.get('filenames','')).split(',') if f.strip()], 'vol':int(float(r.get('volume') or 127)), 'kind':kind,
                   'pitchVar':float(r.get('pitchvariance') or 0), 'minD':float(r.get('mindistance') or 0), 'cut':float(r.get('distancecutoff') or 3000)}
    return True
anim={}
for c in codes:
    for key in (c, c.upper()):
        if key in AL:
            lab=AL[key]['soundlabel']; anim[c.upper()]=lab; addlabel(AS,lab,'anim'); break
combat={}
for k in D['units']:
    u=U.get(k,{}); w=u.get('weaptype1')
    if w and w not in ('_',''):
        combat[k]=w
        for a in ('Flesh','Metal','Wood','Stone','Ethereal'): addlabel(UC,w+a,'combat')
armor={k:U.get(k,{}).get('armor','Flesh') for k in D['units']}
acks={}
for k in D['units']:
    s=U.get(k,{}).get('unitsound')
    if s:
        for t in ('What','Yes','Death','Ready','Pissed','YesAttack'):
            if addlabel(UA,s+t,'ack'): acks.setdefault(k,{})[t]=s+t
for l in ['InterfaceClick','InterfaceError','MenuButtonClick','MapPing','Warning','Rescue','QuestNew','QuestUpdate','Hint','GoodJob','JobDoneSoundHuman','UpgradeCompleteHuman','PlaceBuildingDefault','ConstructingBuildingDefault','UnderAttackHuman','NoGoldHuman','ItemReward','ReceiveGold','PauseGame','ChatroomTimerTick','GlueScreenClick','QuestCompleted','QuestFailed','CantPlaceHuman']:
    addlabel(UI,l,'ui')
music=['Sound\\Music\\mp3Music\\Human1.mp3','Sound\\Music\\mp3Music\\Human2.mp3','Sound\\Music\\mp3Music\\Human3.mp3','Sound\\Music\\mp3Music\\HumanX1.mp3','Sound\\Music\\mp3Music\\HumanVictory.mp3','Sound\\Music\\mp3Music\\HumanDefeat.mp3']
files=sorted(set(f for v in sounds.values() for f in v['files']))+music
have=set()
for dp,dn,fn in os.walk('/home/claude/wc3data/sound'):
    for f in fn: have.add(os.path.relpath(os.path.join(dp,f),'/home/claude/wc3data/sound').lower())
need=[f for f in files if f.replace('\\','/').lower() not in have]
open('/mnt/user-data/outputs/r6.txt','w').write('\n'.join(need)+'\n')
json.dump({'sounds':sounds,'anim':anim,'combat':combat,'armor':armor,'acks':acks,'music':music},open('soundmap.json','w'))
print(len(codes),'codes',len(sounds),'labels',len(files),'files', len(need),'still needed')
