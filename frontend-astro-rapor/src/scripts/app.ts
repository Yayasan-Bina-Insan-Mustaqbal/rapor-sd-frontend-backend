import Alpine from 'alpinejs';
import { buildNav } from './nav-builder';

// Extend Alpine types if needed
declare global {
  interface Window {
    Alpine: typeof Alpine;
  }
}

document.addEventListener('alpine:init', () => {
  Alpine.data('raporApp', () => ({
    isLoading: true,
    currentIframeUrl: '',
    currentBreadcrumb: '',
    toastMessage: '',
    showRefreshToast: false,
    showSemesterModal: false,
    periodData: [] as any[],
    selectedPeriod: null as any,
    navHtml: '',

    get activeYear(): string {
      if (!this.periodData || this.periodData.length === 0) return '';
      const years = Array.from(new Set(this.periodData.map((p: any) => p.tahunAjaran)));
      years.sort((a, b) => {
        const numA = parseInt(a.match(/\d+/)?.[0] || '0', 10);
        const numB = parseInt(b.match(/\d+/)?.[0] || '0', 10);
        return numB - numA;
      });
      return years[0] || '';
    },

    get activePeriods(): any[] {
      const year = this.activeYear;
      if (!year) return this.periodData;
      return this.periodData.filter((p: any) => p.tahunAjaran === year);
    },

    get archivePeriods(): any[] {
      const year = this.activeYear;
      if (!year) return [];
      return this.periodData.filter((p: any) => p.tahunAjaran !== year);
    },

    formatArchiveChipLabel(entry: any): string {
      const shortYear = (entry.tahunAjaran || '').replace(/20(\d{2})\/20(\d{2})/, '$1/$2');
      if (entry.type === 'administrasi' || entry.semester === 0) {
        return `${shortYear} Admin`;
      }
      if (entry.type === 'btq') {
        return `${shortYear} BTQ Sem ${entry.semester}`;
      }
      return `${shortYear} Sem ${entry.semester}`;
    },

    getPeriodBadgeText(): string {
      if (!this.selectedPeriod) return '';
      const p = this.selectedPeriod;
      if (p.type === 'btq') {
        return `BTQ Sem ${p.semester} • ${p.tahunAjaran}`;
      }
      if (p.type === 'administrasi' || p.semester === 0) {
        return `Administrasi • ${p.tahunAjaran}`;
      }
      return `Nilai Sem ${p.semester} • ${p.tahunAjaran}`;
    },

    initApp(navJsonUrl: string) {
      if (!navJsonUrl) navJsonUrl = '/nav.json';
      this.fetchNavData(navJsonUrl);
    },

    async fetchNavData(url: string) {
      try {
        const pwd = sessionStorage.getItem('app_password');
        const response = await fetch(url, { headers: { 'x-admin-password': pwd || '' } });
        
        if (response.status === 403) {
          sessionStorage.removeItem('app_password');
          alert("Invalid password.");
          window.location.reload();
          throw new Error('Unauthorized');
        }
        
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        const navData = await response.json();

        if (!navData || !Array.isArray(navData.data) || navData.data.length === 0) {
          throw new Error('Invalid or empty navigation data received from server.');
        }

        this.periodData = navData.data;

        if (this.periodData.length === 1) {
          // Only one period, skip modal
          this.selectPeriod(this.periodData[0]);
        } else {
          // Show selection modal
          this.showSemesterModal = true;
          this.isLoading = false;
        }
      } catch (error) {
        this.navHtml = `<div class="text-red-400 p-4">Error: Failed to load navigation data.</div>`;
        console.error('Initialization failed:', error);
        this.isLoading = false;
      }
    },

    selectPeriod(period: any) {
      this.selectedPeriod = period;
      this.showSemesterModal = false;
      this.buildNavigation(period);
    },

    buildNavigation(period: any) {
      this.isLoading = true;
      this.currentIframeUrl = '';
      this.currentBreadcrumb = '';
      
      // buildNav now returns an HTML string
      this.navHtml = buildNav(period);
      
      setTimeout(() => {
        this.isLoading = false;
      }, 500);
    },

    handleNavClick(event: Event) {
      const target = event.target as Element;
      const navLink = target.closest('.nav-link') as HTMLAnchorElement | null;
      if (navLink) {
        const url = navLink.dataset.url;
        if (url && url !== '#') {
          this.currentIframeUrl = url;
          this.currentBreadcrumb = navLink.dataset.path || '';
          this.showToast(`Loading: ${this.currentBreadcrumb}`);
          this.isLoading = true;
          this.showRefreshToast = false;
        }
      }
    },

    iframeLoaded() {
      // Called via @load on the iframe
      this.isLoading = false;
      
      // Delay before prompting refresh
      setTimeout(() => {
        if (this.currentIframeUrl) {
          this.showRefreshToast = true;
          // Hide refresh toast after 10 seconds
          setTimeout(() => {
            this.showRefreshToast = false;
          }, 10000);
        }
      }, 5000);
    },

    refreshIframe() {
      if (this.currentIframeUrl) {
        this.showToast('Refreshing content...');
        const currentUrl = this.currentIframeUrl;
        this.currentIframeUrl = ''; // Force re-render
        this.isLoading = true;
        setTimeout(() => {
          this.currentIframeUrl = currentUrl;
        }, 100);
        this.showRefreshToast = false;
      }
    },

    openNewTab() {
      if (this.currentIframeUrl) {
        window.open(this.currentIframeUrl, '_blank');
      }
    },

    closeBreadcrumb() {
      this.currentBreadcrumb = '';
    },

    showToast(message: string) {
      this.toastMessage = message;
      setTimeout(() => {
        if (this.toastMessage === message) {
          this.toastMessage = '';
        }
      }, 3000);
    }
  }));
});

