/**
 * Built-in Orchestra/Band Sample Scores (MusicXML 3.1) & ABC Templates
 * MaestroScroll Studio
 */
window.MAESTRO_SAMPLES = (() => {
  const TYPE_MAP = {
    16: { type: 'whole', dot: false },
    12: { type: 'half', dot: true },
    8:  { type: 'half', dot: false },
    6:  { type: 'quarter', dot: true },
    4:  { type: 'quarter', dot: false },
    3:  { type: 'eighth', dot: true },
    2:  { type: 'eighth', dot: false },
    1:  { type: '16th', dot: false }
  };

  function parseNoteToken(token) {
    // Format: "E4:4", "Bb4:8", "F#5:2", "R:4" (rest), optional dynamic suffix "@f"
    let dyn = null;
    let main = token;
    if (token.includes('@')) {
      const parts = token.split('@');
      main = parts[0];
      dyn = parts[1];
    }
    const [pitchStr, durStr] = main.split(':');
    const dur = parseInt(durStr || '4', 10);
    const durInfo = TYPE_MAP[dur] || { type: 'quarter', dot: false };

    if (pitchStr === 'R') {
      return { rest: true, dur, durInfo, dyn };
    }
    const m = pitchStr.match(/^([A-G])([#b]?)(-?\d)$/);
    if (!m) {
      return { rest: true, dur, durInfo, dyn };
    }
    const step = m[1];
    const alter = m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0;
    const octave = parseInt(m[3], 10);
    return { rest: false, step, alter, octave, dur, durInfo, dyn };
  }

  function buildMusicXML({ title, composer, fifths = 0, beats = 4, beatType = 4, tempo = 110, parts }) {
    const divisions = 4; // quarter = 4
    let partListXml = '';
    let partsXml = '';

    parts.forEach((p, pIdx) => {
      partListXml += `
    <score-part id="${p.id}">
      <part-name>${p.name}</part-name>
      <part-abbreviation>${p.abbr}</part-abbreviation>
    </score-part>`;

      let measuresXml = '';
      p.measures.forEach((tokens, mIdx) => {
        const mNum = mIdx + 1;
        let attrXml = '';
        let dirXml = '';
        if (mIdx === 0) {
          attrXml = `
      <attributes>
        <divisions>${divisions}</divisions>
        <key><fifths>${fifths}</fifths></key>
        <time><beats>${beats}</beats><beat-type>${beatType}</beat-type></time>
        <clef><sign>${p.clefSign || 'G'}</sign><line>${p.clefLine || 2}</line></clef>
      </attributes>`;
          if (pIdx === 0) {
            dirXml = `
      <direction placement="above">
        <direction-type>
          <metronome parentheses="no">
            <beat-unit>quarter</beat-unit>
            <per-minute>${tempo}</per-minute>
          </metronome>
        </direction-type>
        <sound tempo="${tempo}"/>
      </direction>`;
          }
        }

        let notesXml = '';
        tokens.forEach((tok) => {
          const n = parseNoteToken(tok);
          if (n.dyn) {
            notesXml += `
      <direction placement="below">
        <direction-type><dynamics><${n.dyn}/></dynamics></direction-type>
      </direction>`;
          }
          if (n.rest) {
            notesXml += `
      <note>
        <rest/>
        <duration>${n.dur}</duration>
        <type>${n.durInfo.type}</type>${n.durInfo.dot ? '\n        <dot/>' : ''}
      </note>`;
          } else {
            const alterTag = n.alter !== 0 ? `<alter>${n.alter}</alter>` : '';
            notesXml += `
      <note>
        <pitch><step>${n.step}</step>${alterTag}<octave>${n.octave}</octave></pitch>
        <duration>${n.dur}</duration>
        <type>${n.durInfo.type}</type>${n.durInfo.dot ? '\n        <dot/>' : ''}
      </note>`;
          }
        });

        const barlineXml = mIdx === p.measures.length - 1
          ? `\n      <barline location="right"><bar-style>light-heavy</bar-style></barline>`
          : '';

        measuresXml += `
    <measure number="${mNum}">${attrXml}${dirXml}${notesXml}${barlineXml}
    </measure>`;
      });

      partsXml += `
  <part id="${p.id}">${measuresXml}
  </part>`;
    });

    return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 3.1 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">
<score-partwise version="3.1">
  <work><work-title>${title}</work-title></work>
  <identification>
    <creator type="composer">${composer}</creator>
  </identification>
  <part-list>${partListXml}
  </part-list>${partsXml}
</score-partwise>`;
  }

  // 1) Ode to Joy — 5-part Orchestra/Band Arrangement (16 Measures, C Major)
  const odeToJoyXml = buildMusicXML({
    title: 'Symphony No. 9 "Ode to Joy" (Orchestra & Band)',
    composer: 'L. van Beethoven (Arr. MaestroScroll)',
    fifths: 0,
    beats: 4,
    beatType: 4,
    tempo: 112,
    parts: [
      {
        id: 'P1',
        name: 'Flute',
        abbr: 'Fl.',
        clefSign: 'G',
        clefLine: 2,
        measures: [
          ['E5:4@mf', 'E5:4', 'F5:4', 'G5:4'],
          ['G5:4', 'F5:4', 'E5:4', 'D5:4'],
          ['C5:4', 'C5:4', 'D5:4', 'E5:4'],
          ['E5:6', 'D5:2', 'D5:8'],
          ['E5:4', 'E5:4', 'F5:4', 'G5:4'],
          ['G5:4', 'F5:4', 'E5:4', 'D5:4'],
          ['C5:4', 'C5:4', 'D5:4', 'E5:4'],
          ['D5:6', 'C5:2', 'C5:8'],
          ['D5:4@mp', 'D5:4', 'E5:4', 'C5:4'],
          ['D5:4', 'E5:2', 'F5:2', 'E5:4', 'C5:4'],
          ['D5:4', 'E5:2', 'F5:2', 'E5:4', 'D5:4'],
          ['C5:4', 'D5:4', 'G4:8'],
          ['E5:4@f', 'E5:4', 'F5:4', 'G5:4'],
          ['G5:4', 'F5:4', 'E5:4', 'D5:4'],
          ['C5:4', 'C5:4', 'D5:4', 'E5:4'],
          ['D5:6', 'C5:2', 'C5:8']
        ]
      },
      {
        id: 'P2',
        name: 'Bb Clarinet',
        abbr: 'Cl.',
        clefSign: 'G',
        clefLine: 2,
        measures: [
          ['C5:4@mf', 'C5:4', 'D5:4', 'E5:4'],
          ['E5:4', 'D5:4', 'C5:4', 'B4:4'],
          ['G4:4', 'G4:4', 'B4:4', 'C5:4'],
          ['C5:6', 'B4:2', 'B4:8'],
          ['C5:4', 'C5:4', 'D5:4', 'E5:4'],
          ['E5:4', 'D5:4', 'C5:4', 'B4:4'],
          ['G4:4', 'G4:4', 'B4:4', 'C5:4'],
          ['B4:6', 'G4:2', 'G4:8'],
          ['B4:4@mp', 'B4:4', 'C5:4', 'G4:4'],
          ['B4:4', 'C5:4', 'C5:4', 'G4:4'],
          ['B4:4', 'C5:4', 'C5:4', 'B4:4'],
          ['A4:4', 'A4:4', 'B4:8'],
          ['C5:4@f', 'C5:4', 'D5:4', 'E5:4'],
          ['E5:4', 'D5:4', 'C5:4', 'B4:4'],
          ['G4:4', 'A4:4', 'B4:4', 'C5:4'],
          ['B4:6', 'G4:2', 'G4:8']
        ]
      },
      {
        id: 'P3',
        name: 'Bb Trumpet',
        abbr: 'Tpt.',
        clefSign: 'G',
        clefLine: 2,
        measures: [
          ['E4:4@mf', 'E4:4', 'F4:4', 'G4:4'],
          ['G4:4', 'F4:4', 'E4:4', 'D4:4'],
          ['C4:4', 'C4:4', 'D4:4', 'E4:4'],
          ['E4:6', 'D4:2', 'D4:8'],
          ['E4:4', 'E4:4', 'F4:4', 'G4:4'],
          ['G4:4', 'F4:4', 'E4:4', 'D4:4'],
          ['C4:4', 'C4:4', 'D4:4', 'E4:4'],
          ['D4:6', 'C4:2', 'C4:8'],
          ['R:16'],
          ['R:8', 'G4:4@mp', 'E4:4'],
          ['R:8', 'G4:4', 'D4:4'],
          ['E4:4', 'D4:4', 'G4:8'],
          ['E4:4@f', 'E4:4', 'F4:4', 'G4:4'],
          ['G4:4', 'F4:4', 'E4:4', 'D4:4'],
          ['C4:4', 'E4:4', 'G4:4', 'C5:4'],
          ['G4:6', 'E4:2', 'E4:8']
        ]
      },
      {
        id: 'P4',
        name: 'Trombone',
        abbr: 'Tbn.',
        clefSign: 'F',
        clefLine: 4,
        measures: [
          ['G3:8@mf', 'G3:8'],
          ['G3:8', 'G3:8'],
          ['E3:8', 'G3:8'],
          ['G3:8', 'G3:8'],
          ['G3:8', 'G3:8'],
          ['G3:8', 'G3:8'],
          ['E3:8', 'G3:8'],
          ['G3:8', 'E3:8'],
          ['G3:4@mp', 'G3:4', 'G3:4', 'E3:4'],
          ['G3:8', 'G3:4', 'E3:4'],
          ['G3:8', 'G3:4', 'G3:4'],
          ['F#3:4', 'F#3:4', 'G3:8'],
          ['G3:8@f', 'B3:8'],
          ['B3:8', 'G3:8'],
          ['E3:4', 'F3:4', 'G3:4', 'G3:4'],
          ['G3:8', 'G3:8']
        ]
      },
      {
        id: 'P5',
        name: 'Tuba / Bass',
        abbr: 'Tba.',
        clefSign: 'F',
        clefLine: 4,
        measures: [
          ['C3:8@mf', 'C3:8'],
          ['G2:8', 'G2:8'],
          ['C3:8', 'G2:8'],
          ['G2:16'],
          ['C3:8', 'C3:8'],
          ['G2:8', 'G2:8'],
          ['C3:8', 'G2:8'],
          ['G2:8', 'C3:8'],
          ['G2:8@mp', 'C3:8'],
          ['G2:8', 'C3:8'],
          ['G2:8', 'G2:8'],
          ['D3:8', 'G2:8'],
          ['C3:4@f', 'C3:4', 'G2:4', 'G2:4'],
          ['G2:4', 'B2:4', 'C3:4', 'G2:4'],
          ['A2:4', 'F2:4', 'G2:4', 'G2:4'],
          ['G2:8', 'C2:8']
        ]
      }
    ]
  });

  // 2) Warm-up Chorale in Concert Bb Major — 4-part Symphonic Band
  const royalChoraleXml = buildMusicXML({
    title: 'Symphonic Band Warm-Up Chorale (Bb Major)',
    composer: 'MaestroScroll Band Method',
    fifths: -2,
    beats: 4,
    beatType: 4,
    tempo: 76,
    parts: [
      {
        id: 'P1',
        name: 'Flute / Oboe',
        abbr: 'Fl.',
        clefSign: 'G',
        clefLine: 2,
        measures: [
          ['Bb4:8@mp', 'C5:8'],
          ['D5:8', 'Eb5:8'],
          ['F5:8', 'Eb5:4', 'D5:4'],
          ['C5:16'],
          ['D5:8@mf', 'F5:8'],
          ['G5:8', 'Eb5:8'],
          ['D5:8', 'C5:8'],
          ['Bb4:16@p']
        ]
      },
      {
        id: 'P2',
        name: 'Bb Clarinet',
        abbr: 'Cl.',
        clefSign: 'G',
        clefLine: 2,
        measures: [
          ['F4:8@mp', 'A4:8'],
          ['Bb4:8', 'Bb4:8'],
          ['Bb4:8', 'Bb4:8'],
          ['A4:16'],
          ['Bb4:8@mf', 'D5:8'],
          ['Eb5:8', 'C5:8'],
          ['Bb4:8', 'A4:8'],
          ['F4:16@p']
        ]
      },
      {
        id: 'P3',
        name: 'F Horn / Alto Sax',
        abbr: 'Hn.',
        clefSign: 'G',
        clefLine: 2,
        measures: [
          ['D4:8@mp', 'F4:8'],
          ['F4:8', 'G4:8'],
          ['D4:8', 'G4:8'],
          ['F4:16'],
          ['F4:8@mf', 'Bb4:8'],
          ['Bb4:8', 'G4:8'],
          ['F4:8', 'Eb4:8'],
          ['D4:16@p']
        ]
      },
      {
        id: 'P4',
        name: 'Trombone / Tuba',
        abbr: 'Low',
        clefSign: 'F',
        clefLine: 4,
        measures: [
          ['Bb2:8@mp', 'F3:8'],
          ['Bb2:8', 'Eb3:8'],
          ['D3:8', 'Eb3:8'],
          ['F3:16'],
          ['Bb2:8@mf', 'D3:8'],
          ['Eb3:8', 'C3:8'],
          ['F3:8', 'F2:8'],
          ['Bb2:16@p']
        ]
      }
    ]
  });

  // 3) Victory Fanfare March — 4-part Marching Band
  const victoryMarchXml = buildMusicXML({
    title: 'Victory Fanfare & Street March',
    composer: 'MaestroScroll Marching Series',
    fifths: -1,
    beats: 4,
    beatType: 4,
    tempo: 124,
    parts: [
      {
        id: 'P1',
        name: 'Piccolo / Flute',
        abbr: 'Picc.',
        clefSign: 'G',
        clefLine: 2,
        measures: [
          ['F5:4@f', 'F5:2', 'F5:2', 'F5:4', 'C5:4'],
          ['D5:4', 'E5:4', 'F5:8'],
          ['G5:4', 'G5:2', 'G5:2', 'A5:4', 'Bb5:4'],
          ['A5:8', 'G5:8'],
          ['C6:4@ff', 'A5:4', 'F5:4', 'D5:4'],
          ['Bb5:4', 'G5:4', 'E5:4', 'C5:4'],
          ['F5:4', 'G5:4', 'A5:4', 'Bb5:4'],
          ['C6:8', 'F5:8']
        ]
      },
      {
        id: 'P2',
        name: 'Bb Trumpet',
        abbr: 'Tpt.',
        clefSign: 'G',
        clefLine: 2,
        measures: [
          ['C5:4@f', 'C5:2', 'C5:2', 'C5:4', 'A4:4'],
          ['Bb4:4', 'C5:4', 'A4:8'],
          ['C5:4', 'C5:2', 'C5:2', 'F5:4', 'G5:4'],
          ['F5:8', 'E5:8'],
          ['A5:4@ff', 'F5:4', 'C5:4', 'A4:4'],
          ['G5:4', 'E5:4', 'C5:4', 'Bb4:4'],
          ['A4:4', 'C5:4', 'F5:4', 'G5:4'],
          ['A5:8', 'F4:8']
        ]
      },
      {
        id: 'P3',
        name: 'Trombone',
        abbr: 'Tbn.',
        clefSign: 'F',
        clefLine: 4,
        measures: [
          ['A3:4@f', 'A3:2', 'A3:2', 'A3:4', 'F3:4'],
          ['G3:4', 'G3:4', 'A3:8'],
          ['E3:4', 'E3:2', 'E3:2', 'F3:4', 'G3:4'],
          ['C4:8', 'C4:8'],
          ['C4:4@ff', 'C4:4', 'A3:4', 'F3:4'],
          ['G3:4', 'G3:4', 'G3:4', 'E3:4'],
          ['F3:4', 'E3:4', 'F3:4', 'G3:4'],
          ['A3:8', 'F3:8']
        ]
      },
      {
        id: 'P4',
        name: 'Sousaphone / Bass',
        abbr: 'Bass',
        clefSign: 'F',
        clefLine: 4,
        measures: [
          ['F2:4@f', 'C3:4', 'F2:4', 'C3:4'],
          ['Bb2:4', 'C3:4', 'F2:4', 'C3:4'],
          ['C3:4', 'G2:4', 'C3:4', 'E3:4'],
          ['F3:4', 'E3:4', 'C3:8'],
          ['F2:4@ff', 'A2:4', 'C3:4', 'F3:4'],
          ['G2:4', 'Bb2:4', 'C3:4', 'C2:4'],
          ['F2:4', 'E2:4', 'D2:4', 'Bb2:4'],
          ['C3:8', 'F2:8']
        ]
      }
    ]
  });

  // ABC Notation Multi-Voice Templates
  const abcTemplates = {
    wind_quartet: `X:1
T:Fanfare for Wind Quartet
C:Arr. MaestroScroll
M:4/4
L:1/4
Q:1/4=116
K:Bb
%%score (1 2) (3 4)
V:1 name="Flute" snm="Fl." clef=treble
!mf! B2 c d | f2 e d | c B A c | B4 |
!f! d2 f g | f e d c | B c d f | B4 |]
V:2 name="Bb Clarinet" snm="Cl." clef=treble
!mf! F2 A B | d2 c B | A G F A | F4 |
!f! B2 d e | d c B A | F A B d | F4 |]
V:3 name="Bb Trumpet" snm="Tpt." clef=treble
!mf! D2 F F | B2 G F | E D C F | D4 |
!f! F2 B B | B G F E | D F F B | D4 |]
V:4 name="Trombone / Bass" snm="Tbn." clef=bass
!mf! B,,2 F, B,, | B,,2 E, D, | F,2 F,,2 | B,,4 |
!f! B,,2 D, E, | D, C, B,, F, | D, F, B,,2 | B,,4 |]`,

    string_quartet: `X:1
T:Serenade for Strings
C:MaestroScroll Chamber
M:3/4
L:1/4
Q:1/4=96
K:G
%%score 1 2 3 4
V:1 name="Violin I" snm="Vln.I" clef=treble
!p! B2 d | g2 f | e d c | B3 |
!mf! A2 c | f2 e | d c A | G3 |]
V:2 name="Violin II" snm="Vln.II" clef=treble
!p! G2 B | d2 d | c B A | G3 |
!mf! F2 A | c2 c | B A F | D3 |]
V:3 name="Viola" snm="Vla." clef=alto
!p! D2 G | B2 A | G2 F | D3 |
!mf! D2 F | A2 G | F2 D | B,3 |]
V:4 name="Cello" snm="Vc." clef=bass
!p! G,3 | B,3 | C2 D | G,3 |
!mf! D,3 | D,3 | D,2 D, | G,,3 |]`,

    marching_cadence: `X:1
T:School Spirit March
C:Drum & Bugle Corps
M:4/4
L:1/8
Q:1/4=124
K:F
V:1 name="Lead Brass" snm="Br." clef=treble
!f! F2 FF A2 c2 | d2 cB A4 | G2 GG B2 d2 | c2 BA G4 |
!ff! f2 ed c2 BA | G2 AB c4 | F2 GA B2 cd | c4 F4 |]
V:2 name="Low Brass" snm="Low" clef=bass
!f! F,2 z2 C,2 z2 | B,,2 D,2 F,4 | C,2 z2 G,2 z2 | C,2 E,2 G,4 |
!ff! F,2 C,2 A,,2 F,,2 | G,,2 B,,2 C,4 | F,2 E,2 D,2 B,,2 | C,4 F,,4 |]`,

    solo_lead: `X:1
T:Thai Classical Melody (Lead Sheet)
C:Traditional Arr.
M:4/4
L:1/4
Q:1/4=100
K:C
V:1 name="Melody" snm="Mel." clef=treble
"C" E G A c | "Am" A G E2 | "F" F A c A | "G" G4 |
"C" e d c A | "Em" G E G2 | "Dm" D E "G7" G A | "C" c4 |]`
  };

  return {
    musicxml: {
      ode_to_joy_orchestra: {
        title: 'Symphony No. 9 "Ode to Joy" (วง 5 พาร์ท)',
        xml: odeToJoyXml
      },
      royal_band_chorale: {
        title: 'Warm-up Chorale in Bb (วงดุริยางค์ 4 พาร์ท)',
        xml: royalChoraleXml
      },
      victory_fanfare_march: {
        title: 'Victory Fanfare March (มาร์ช 4 พาร์ท)',
        xml: victoryMarchXml
      }
    },
    abc: abcTemplates
  };
})();
