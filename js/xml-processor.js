/**
 * MusicXMLProcessor — Parse, Filter Parts, Transpose Key/Pitch,
 * Decompress .mxl, and Extract Multi-Part Playback Sequences
 */
class MusicXMLProcessor {
  static STEP_TO_SEMI = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

  static SHARP_SPELLINGS = [
    { step: 'C', alter: 0 },
    { step: 'C', alter: 1 },
    { step: 'D', alter: 0 },
    { step: 'D', alter: 1 },
    { step: 'E', alter: 0 },
    { step: 'F', alter: 0 },
    { step: 'F', alter: 1 },
    { step: 'G', alter: 0 },
    { step: 'G', alter: 1 },
    { step: 'A', alter: 0 },
    { step: 'A', alter: 1 },
    { step: 'B', alter: 0 }
  ];

  static FLAT_SPELLINGS = [
    { step: 'C', alter: 0 },
    { step: 'D', alter: -1 },
    { step: 'D', alter: 0 },
    { step: 'E', alter: -1 },
    { step: 'E', alter: 0 },
    { step: 'F', alter: 0 },
    { step: 'G', alter: -1 },
    { step: 'G', alter: 0 },
    { step: 'A', alter: -1 },
    { step: 'A', alter: 0 },
    { step: 'B', alter: -1 },
    { step: 'B', alter: 0 }
  ];

  static async readUploadedFile(file) {
    const name = file.name.toLowerCase();
    if (name.endsWith('.mxl')) {
      if (!window.JSZip) {
        throw new Error('JSZip library not loaded for .mxl extraction');
      }
      const buf = await file.arrayBuffer();
      const zip = await window.JSZip.loadAsync(buf);
      let targetPath = null;
      const containerFile = zip.file('META-INF/container.xml');
      if (containerFile) {
        const containerXml = await containerFile.async('string');
        const match = containerXml.match(/full-path="([^"]+)"/);
        if (match) targetPath = match[1];
      }
      if (!targetPath || !zip.file(targetPath)) {
        targetPath = Object.keys(zip.files).find(
          (k) => !k.startsWith('META-INF') && (k.endsWith('.xml') || k.endsWith('.musicxml'))
        );
      }
      if (!targetPath) {
        throw new Error('ไม่พบไฟล์ MusicXML ภายในไฟล์ .mxl นี้');
      }
      return await zip.file(targetPath).async('string');
    }
    return await file.text();
  }

  static sanitizeXml(xmlString) {
    if (typeof xmlString !== 'string') return '';
    return xmlString
      .replace(/^\uFEFF/, '')
      .trim()
      .replace(/&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/g, '&amp;');
  }

  static parseMetadata(xmlString) {
    const cleanXml = MusicXMLProcessor.sanitizeXml(xmlString);
    const parser = new DOMParser();
    const doc = parser.parseFromString(cleanXml, 'application/xml');
    const parseErr = doc.querySelector('parsererror');
    if (parseErr) {
      throw new Error('รูปแบบ XML ไม่ถูกต้อง');
    }

    const title =
      doc.querySelector('work > work-title')?.textContent?.trim() ||
      doc.querySelector('movement-title')?.textContent?.trim() ||
      'Untitled Score';

    const composer =
      doc.querySelector('identification > creator[type="composer"]')?.textContent?.trim() ||
      doc.querySelector('identification > creator')?.textContent?.trim() ||
      '';

    const soundEl = doc.querySelector('sound[tempo]');
    const perMinEl = doc.querySelector('metronome > per-minute');
    const tempo = parseInt(soundEl?.getAttribute('tempo') || perMinEl?.textContent || '110', 10) || 110;

    const parts = Array.from(doc.querySelectorAll('part-list > score-part')).map((sp, idx) => ({
      id: sp.getAttribute('id') || `P${idx + 1}`,
      name: sp.querySelector('part-name')?.textContent?.trim() || `Part ${idx + 1}`,
      abbr: sp.querySelector('part-abbreviation')?.textContent?.trim() || ''
    }));

    const firstPart = doc.querySelector('score-partwise > part');
    const totalMeasures = firstPart ? firstPart.querySelectorAll('measure').length : 0;

    return { doc, title, composer, tempo, parts, totalMeasures };
  }

  static filterParts(xmlString, selectedPartIds) {
    const cleanXml = MusicXMLProcessor.sanitizeXml(xmlString);
    if (!selectedPartIds || selectedPartIds.length === 0) return cleanXml;
    const parser = new DOMParser();
    const doc = parser.parseFromString(cleanXml, 'application/xml');
    const selectedSet = new Set(selectedPartIds);

    const allScoreParts = Array.from(doc.querySelectorAll('part-list > score-part'));
    if (allScoreParts.length > 0 && selectedSet.size >= allScoreParts.length) {
      return cleanXml;
    }

    allScoreParts.forEach((sp) => {
      if (!selectedSet.has(sp.getAttribute('id'))) {
        sp.parentNode.removeChild(sp);
      }
    });

    // Clean any part-group tags when filtering individual parts to avoid orphaned brackets
    doc.querySelectorAll('part-list > part-group').forEach((pg) => {
      pg.parentNode.removeChild(pg);
    });

    doc.querySelectorAll('score-partwise > part').forEach((partEl) => {
      if (!selectedSet.has(partEl.getAttribute('id'))) {
        partEl.parentNode.removeChild(partEl);
      }
    });

    return new XMLSerializer().serializeToString(doc);
  }

  static transpose(xmlString, semitones) {
    const cleanXml = MusicXMLProcessor.sanitizeXml(xmlString);
    const semi = parseInt(semitones, 10) || 0;
    if (semi === 0) return cleanXml;

    const parser = new DOMParser();
    const doc = parser.parseFromString(cleanXml, 'application/xml');

    let latestFifths = 0;

    doc.querySelectorAll('score-partwise > part').forEach((partEl) => {
      let partUseFlats = false;

      partEl.querySelectorAll('measure').forEach((measureEl) => {
        const fifthsEl = measureEl.querySelector('attributes > key > fifths');
        if (fifthsEl) {
          const origFifths = parseInt(fifthsEl.textContent || '0', 10) || 0;
          const newFifths = ((origFifths + semi * 7 + 1200 + 5) % 12) - 5;
          fifthsEl.textContent = String(newFifths);
          latestFifths = newFifths;
          partUseFlats = newFifths < 0;
        }

        measureEl.querySelectorAll('note').forEach((noteEl) => {
          const pitchEl = noteEl.querySelector('pitch');
          if (!pitchEl) return;

          const stepEl = pitchEl.querySelector('step');
          const octaveEl = pitchEl.querySelector('octave');
          if (!stepEl || !octaveEl) return;

          const step = stepEl.textContent.trim().toUpperCase();
          const alterEl = pitchEl.querySelector('alter');
          const alter = alterEl ? parseInt(alterEl.textContent || '0', 10) : 0;
          const octave = parseInt(octaveEl.textContent || '4', 10);

          const origMidi = (octave + 1) * 12 + (MusicXMLProcessor.STEP_TO_SEMI[step] ?? 0) + alter;
          const newMidi = origMidi + semi;
          const newOctave = Math.floor(newMidi / 12) - 1;
          const pc = ((newMidi % 12) + 12) % 12;

          const spellingTable = partUseFlats
            ? MusicXMLProcessor.FLAT_SPELLINGS
            : MusicXMLProcessor.SHARP_SPELLINGS;
          const spelled = spellingTable[pc];

          stepEl.textContent = spelled.step;
          octaveEl.textContent = String(newOctave);

          if (spelled.alter !== 0) {
            if (alterEl) {
              alterEl.textContent = String(spelled.alter);
            } else {
              const newAlter = doc.createElement('alter');
              newAlter.textContent = String(spelled.alter);
              pitchEl.insertBefore(newAlter, octaveEl);
            }
          } else if (alterEl) {
            pitchEl.removeChild(alterEl);
          }

          // Remove stale explicit accidental so OSMD computes clean notation for new key
          const accEl = noteEl.querySelector('accidental');
          if (accEl) noteEl.removeChild(accEl);
        });
      });
    });

    // Keep latestFifths referenced cleanly
    void latestFifths;
    return new XMLSerializer().serializeToString(doc);
  }

  static extractSequence(xmlString) {
    const cleanXml = MusicXMLProcessor.sanitizeXml(xmlString);
    const meta = MusicXMLProcessor.parseMetadata(cleanXml);
    const { doc, tempo, parts } = meta;

    const partMap = new Map(parts.map((p) => [p.id, p]));
    const events = [];
    let maxBeats = 0;

    doc.querySelectorAll('score-partwise > part').forEach((partEl) => {
      const partId = partEl.getAttribute('id');
      const partName = partMap.get(partId)?.name || partId;
      let divisions = 1;
      let cursorBeat = 0;
      let lastNoteStartBeat = 0;

      const measures = Array.from(partEl.querySelectorAll('measure'));
      measures.forEach((measureEl, mIdx) => {
        const measureNumber = parseInt(measureEl.getAttribute('number') || String(mIdx + 1), 10);
        const divEl = measureEl.querySelector('attributes > divisions');
        if (divEl) {
          divisions = Math.max(1, parseInt(divEl.textContent || '1', 10));
        }

        const children = Array.from(measureEl.children);
        children.forEach((child) => {
          if (child.tagName === 'backup') {
            const dur = parseInt(child.querySelector('duration')?.textContent || '0', 10);
            cursorBeat = Math.max(0, cursorBeat - dur / divisions);
          } else if (child.tagName === 'forward') {
            const dur = parseInt(child.querySelector('duration')?.textContent || '0', 10);
            cursorBeat += dur / divisions;
          } else if (child.tagName === 'note') {
            const isGrace = !!child.querySelector('grace');
            if (isGrace) return;

            const isChord = !!child.querySelector('chord');
            const isRest = !!child.querySelector('rest');
            const durDivs = parseInt(child.querySelector('duration')?.textContent || '0', 10);
            const durBeats = durDivs / divisions;

            const startBeat = isChord ? lastNoteStartBeat : cursorBeat;
            if (!isChord) {
              lastNoteStartBeat = cursorBeat;
              cursorBeat += durBeats;
            }

            // Skip tied continuation notes so held notes sound smoothly
            const tieStop = Array.from(child.querySelectorAll('tie')).some(
              (t) => t.getAttribute('type') === 'stop'
            );
            if (tieStop) return;

            let midiPitch = null;
            if (!isRest) {
              const pitchEl = child.querySelector('pitch');
              if (pitchEl) {
                const step = pitchEl.querySelector('step')?.textContent?.trim()?.toUpperCase();
                const alter = parseInt(pitchEl.querySelector('alter')?.textContent || '0', 10);
                const octave = parseInt(pitchEl.querySelector('octave')?.textContent || '4', 10);
                if (step && MusicXMLProcessor.STEP_TO_SEMI[step] !== undefined) {
                  midiPitch = (octave + 1) * 12 + MusicXMLProcessor.STEP_TO_SEMI[step] + alter;
                }
              } else if (child.querySelector('unpitched')) {
                midiPitch = 48; // Percussion fallback
              }
            }

            events.push({
              partId,
              partName,
              measureNumber,
              startBeat,
              durationBeats: durBeats,
              midiPitch
            });
          }
        });

        if (cursorBeat > maxBeats) maxBeats = cursorBeat;
      });
    });

    events.sort((a, b) => a.startBeat - b.startBeat);

    return {
      tempoBpm: tempo,
      totalBeats: maxBeats,
      totalMeasures: meta.totalMeasures,
      parts,
      events
    };
  }
}

window.MusicXMLProcessor = MusicXMLProcessor;
