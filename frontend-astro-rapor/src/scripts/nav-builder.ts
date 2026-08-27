import { constructGSheetUrl } from './url-builder';

// ─── Mega Menu (Mapel) ────────────────────────────────────────────────────────

/**
 * Creates the HTML for a mega menu for a specific grade level (e.g. "Kelas 1").
 */
export function createMegaMenu(id: string, data: any[]): string {
  let columnsHtml = '';
  const pathPrefix = [id];

  data.forEach((kelas) => {
    let linksHtml = '';
    const kelasPath = [...pathPrefix, kelas.label];

    kelas.children.forEach((mapel: any) => {
      const mapelPath = [...kelasPath, mapel.label];

      if ((mapel.label === 'Rekapitulasi' || mapel.label === 'Cetak Rapor') && mapel.children) {
        linksHtml += `<hr class="my-2 border-gray-200">`;
        mapel.children.forEach((sub: any) => {
          const url = constructGSheetUrl(sub.value);
          const subPath = [...mapelPath, sub.label];
          linksHtml += `<a href="#" data-url="${url}" data-path="${subPath.join(' > ')}" class="nav-link flex w-full items-center justify-between rounded-md px-2 py-1 text-gray-600 hover:bg-atlantis-100 hover:text-black"><span>${sub.label}</span></a>`;
        });
      } else {
        const url = constructGSheetUrl(mapel.value);
        linksHtml += `<a href="#" data-url="${url}" data-path="${mapelPath.join(' > ')}" class="nav-link flex w-full items-center justify-between rounded-md px-2 py-1 text-gray-600 hover:bg-atlantis-100 hover:text-black"><span>${mapel.label}</span></a>`;
      }
    });

    columnsHtml += `
      <div class="px-2">
        <h4 class="font-semibold text-lg mb-2 text-gray-800">${kelas.label}</h4>
        <div class="space-y-1">${linksHtml}</div>
      </div>`;
  });

  return `
    <div class="dropdown dropdown-hover static">
      <button tabindex="0" class="px-4 py-4 text-white flex items-center hover:bg-atlantis-500 transition-colors duration-300">
        <span>${id}</span>
        <svg class="w-4 h-4 ml-1 fill-current" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><path d="M9.293 12.95l.707.707L15.657 8l-1.414-1.414L10 10.828 5.757 6.586 4.343 8z"/></svg>
      </button>
      <div tabindex="0" class="dropdown-content absolute left-0 w-full bg-white shadow-lg z-10">
        <div class="container mx-auto px-4 max-h-[80vh] overflow-y-auto cursor-default">
          <div class="py-4 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">${columnsHtml}</div>
        </div>
      </div>
    </div>`;
}

// ─── Vertical Flyout Menu (Ekskul) ────────────────────────────────────────────

/**
 * Creates the HTML for the "Ekstrakurikuler" vertical flyout dropdown menu.
 * Supports a 3-level flyout:
 *   Ekstrakurikuler → Kelas X → Class (e.g. 1A) → Level / Nilai
 *
 * If a class child has `valueLevel` or `valueNilai` (new format), it renders
 * a sub-flyout with "Level" and "Nilai" links.
 * If it only has `value` (legacy format), it renders a direct link.
 */
export function createVerticalMenu(id: string, data: any[]): string {
  let linksHtml = '';
  const pathPrefix = [id];

  data.forEach((kelas) => {
    let subLinksHtml = '';
    const kelasPath = [...pathPrefix, kelas.label];

    if (kelas.children) {
      kelas.children.forEach((sub: any) => {
        const subPath = [...kelasPath, sub.label];

        // ── New format: valueLevel + valueNilai → 3-level flyout ──────────────
        if (sub.valueLevel || sub.valueNilai) {
          const levelUrl  = sub.valueLevel ? constructGSheetUrl(sub.valueLevel) : '#';
          const nilaiUrl  = sub.valueNilai  ? constructGSheetUrl(sub.valueNilai)  : '#';
          const levelPath = [...subPath, 'Level'].join(' > ');
          const nilaiPath  = [...subPath, 'Nilai'].join(' > ');

          subLinksHtml += `
            <div class="dropdown dropdown-hover dropdown-right block w-full relative">
              <div tabindex="0" role="button" class="nav-link flex w-full items-center justify-between px-4 py-1.5 text-sm text-gray-700 hover:bg-atlantis-100 focus:bg-atlantis-100">
                <span>${sub.label}</span>
                <svg class="h-4 w-4 text-gray-400 flex-shrink-0" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor">
                  <path fill-rule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clip-rule="evenodd"></path>
                </svg>
              </div>
              <div tabindex="0" class="dropdown-content absolute left-full -top-px -ml-px z-30 w-28 rounded-md border bg-white shadow-lg">
                <a href="#" data-url="${levelUrl}" data-path="${levelPath}" class="nav-link flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-atlantis-100 rounded-t-md">
                  <svg class="h-3.5 w-3.5 text-atlantis-600 flex-shrink-0" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor">
                    <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z"/>
                  </svg>
                  Level
                </a>
                <a href="#" data-url="${nilaiUrl}" data-path="${nilaiPath}" class="nav-link flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-atlantis-100 rounded-b-md border-t border-gray-100">
                  <svg class="h-3.5 w-3.5 text-atlantis-600 flex-shrink-0" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor">
                    <path fill-rule="evenodd" d="M6 2a2 2 0 00-2 2v12a2 2 0 002 2h8a2 2 0 002-2V7.414A2 2 0 0015.414 6L12 2.586A2 2 0 0010.586 2H6zm2 10a1 1 0 10-2 0v3a1 1 0 102 0v-3zm2-3a1 1 0 011 1v5a1 1 0 11-2 0v-5a1 1 0 011-1zm4-1a1 1 0 10-2 0v7a1 1 0 102 0V8z" clip-rule="evenodd"/>
                  </svg>
                  Nilai
                </a>
              </div>
            </div>`;

        // ── Legacy format: single value → direct link ──────────────────────────
        } else {
          const url = constructGSheetUrl(sub.value);
          subLinksHtml += `<a href="#" data-url="${url}" data-path="${subPath.join(' > ')}" class="nav-link block px-4 py-1.5 text-sm text-gray-600 hover:bg-atlantis-100">${sub.label}</a>`;
        }
      });
    }

    linksHtml += `
      <div class="dropdown dropdown-hover dropdown-right block w-full relative">
        <a href="#" tabindex="0" data-url="${constructGSheetUrl(kelas.value)}" data-path="${kelasPath.join(' > ')}" class="nav-link flex w-full items-center justify-between px-4 py-1.5 text-sm text-gray-700 hover:bg-atlantis-100 focus:bg-atlantis-100">
          <span>${kelas.label}</span>
          ${kelas.children && kelas.children.length > 0
            ? `<svg class="h-5 w-5 text-gray-400" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clip-rule="evenodd"></path></svg>`
            : ''}
        </a>
        ${subLinksHtml ? `
        <div tabindex="0" class="dropdown-content absolute left-full -top-px -ml-px z-20 w-32 rounded-md border bg-white shadow-lg">
          ${subLinksHtml}
        </div>
        ` : ''}
      </div>`;
  });

  return `
    <div class="dropdown dropdown-hover relative">
      <button tabindex="0" class="px-4 py-4 text-white flex items-center hover:bg-atlantis-500 transition-colors duration-300">
        <span>${id}</span>
        <svg class="w-4 h-4 ml-1 fill-current" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><path d="M9.293 12.95l.707.707L15.657 8l-1.414-1.414L10 10.828 5.757 6.586 4.343 8z"/></svg>
      </button>
      <div tabindex="0" class="dropdown-content absolute top-full right-0 w-56 bg-white rounded-md shadow-lg z-20 border">
        <div class="py-1 cursor-default">${linksHtml}</div>
      </div>
    </div>`;
}

// ─── Build Nav ────────────────────────────────────────────────────────────────

/**
 * Builds and returns the navigation HTML for the selected period entry.
 */
export function buildNav(entry: any): string {
  const mapelData: any[]  = entry.data.dataMapel  ?? [];
  const ekskulData: any[] = entry.data.dataEkskul ?? [];

  // Group classes by grade number (e.g. "Kelas 1", "Kelas 2", ...)
  const groupedByGrade = mapelData.reduce((acc: Record<string, any[]>, currentClass: any) => {
    const match = currentClass.label.match(/\d+/);
    if (!match) return acc;
    const gradeName = `Kelas ${match[0]}`;
    if (!acc[gradeName]) acc[gradeName] = [];
    acc[gradeName].push(currentClass);
    return acc;
  }, {});

  // Sort grades numerically
  const sortedGrades = Object.keys(groupedByGrade).sort(
    (a, b) => parseInt(a.match(/\d+/)![0]) - parseInt(b.match(/\d+/)![0])
  );

  let navHtml = '';
  sortedGrades.forEach((grade) => {
    navHtml += createMegaMenu(grade, groupedByGrade[grade]);
  });

  if (ekskulData.length > 0) {
    navHtml += createVerticalMenu('Ekstrakurikuler', ekskulData);
  }

  const standaloneData: any[] = entry.data.dataStandalone ?? [];
  if (standaloneData.length > 0) {
    standaloneData.forEach((item: any) => {
      const url = constructGSheetUrl(item.value);
      navHtml += `
        <a href="#" data-url="${url}" data-path="${item.label}" class="nav-link px-4 py-4 text-white flex items-center hover:bg-atlantis-500 transition-colors duration-300">
          <span>${item.label}</span>
        </a>`;
    });
  }

  return navHtml;
}

