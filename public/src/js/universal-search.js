(() => {
    const scriptUrl = document.currentScript.src;
    const viewsBase = new URL('../views/', scriptUrl);

    document.addEventListener('DOMContentLoaded', () => {
        const searchBtn = document.querySelector('.search-action');
        const topbar = searchBtn?.closest('.topbar, .settings-search-host');
        const searchInput = topbar?.querySelector('.search-input');
        const searchWrapper = topbar?.querySelector('.search-wrapper');
        if (!searchBtn || !topbar || !searchInput || !searchWrapper) return;

        topbar.classList.add('quick-search-topbar');
        searchWrapper.setAttribute('role', 'search');
        searchInput.type = 'text';
        if (!searchInput.id) searchInput.id = 'quick-search';
        const localSearchType = document.getElementById('documentsGrid') ? 'documentos' : null;
        searchInput.placeholder = 'Buscar una acción o sección...';
        searchInput.setAttribute('aria-label', 'Buscar una acción o sección');
        searchInput.setAttribute('role', 'combobox');
        searchInput.setAttribute('aria-autocomplete', 'list');
        searchInput.setAttribute('aria-controls', 'search-results-list');
        searchInput.setAttribute('aria-expanded', 'false');
        searchInput.setAttribute('autocomplete', 'off');
        searchInput.tabIndex = -1;
        searchBtn.setAttribute('aria-label', 'Abrir búsqueda');
        searchBtn.setAttribute('aria-controls', searchInput.id);
        searchBtn.setAttribute('aria-expanded', 'false');

        let searchPanel = topbar.querySelector('.search-results');
        if (!searchPanel) {
            searchPanel = document.createElement('div');
            searchPanel.className = 'search-results';
            searchPanel.id = 'search-results';
            searchPanel.hidden = true;
            searchPanel.innerHTML = '<div class="search-results-heading"><span id="search-results-title">Accesos rápidos</span></div>' +
                '<ul id="search-results-list" class="search-results-list" role="listbox" aria-label="Resultados de búsqueda"></ul>' +
                '<p class="search-results-footer">Haz clic en una opción disponible para ir a esa sección.</p>';
            topbar.append(searchPanel);
            const status = document.createElement('span');
            status.id = 'search-status';
            status.className = 'visually-hidden';
            status.setAttribute('role', 'status');
            status.setAttribute('aria-live', 'polite');
            topbar.append(status);
        }

        const searchList = searchPanel.querySelector('#search-results-list');
        const searchTitle = searchPanel.querySelector('#search-results-title');
        const searchStatus = topbar.querySelector('#search-status');
        if (!searchList || !searchTitle || !searchStatus) return;
        if (localSearchType) {
            searchPanel.querySelector('.search-results-footer').textContent =
                localSearchType === 'documentos'
                    ? 'Haz clic en una opción para ir a esa sección. Usá la búsqueda de la lista para filtrar documentos.'
                    : `Haz clic en una opción para ir a esa sección. La lista de ${localSearchType} también se filtra.`;
        }

        const destinations = [
            {
                title: 'Cargar documento',
                section: 'Documentos',
                detail: 'Abrir formulario de carga',
                href: 'documents/documents-upload.html',
                icon: '../../assets/Icons/folder-icon.svg',
                terms: 'subir documento cargar archivo adjuntar archivo nuevo documento'
            },
            {
                title: 'Gestionar pacientes',
                section: 'Gestión',
                detail: 'Abrir la sección de pacientes',
                href: 'management/patients.html',
                requiredRole: 'records_manager',
                icon: '../../assets/Icons/database-cog.svg',
                terms: 'cargar paciente registrar paciente agregar paciente nuevo paciente'
            },
            {
                title: 'Gestionar médicos',
                section: 'Gestión',
                detail: 'Equipo médico y especialidades',
                href: 'management/doctors.html',
                requiredRole: 'records_manager',
                icon: '../../assets/Icons/doctor-icon.svg',
                terms: 'doctores medicos médicos especialistas registrar agregar nuevo médico doctor'
            },
            {
                title: 'Gestionar ambulancias',
                section: 'Gestión',
                detail: 'Abrir la sección de ambulancias',
                href: 'management/ambulances.html',
                requiredRole: 'dispatcher',
                icon: '../../assets/Icons/ambulance-icon.png',
                terms: 'cargar vehiculo cargar vehículo registrar ambulancia agregar vehiculo transporte'
            },
            {
                title: 'Crear encuesta',
                section: 'Encuestas',
                detail: 'Crear un borrador de encuesta',
                href: 'surveys/survey-new.html',
                icon: '../../assets/Icons/survey-icon.svg',
                terms: 'crear encuesta nueva encuesta subir encuesta'
            },
            {
                title: 'Gestionar cuentas',
                section: 'Gestión', detail: 'Aprobación y permisos del personal', href: 'management/accounts.html', requiredRole: 'admin', icon: '../../assets/Icons/person-icon.svg', terms: 'cuentas usuarios aprobar permisos roles',
            },
            {
                title: 'Gestionar rutas',
                section: 'Gestión',
                detail: 'Recorridos opcionales para traslados',
                href: 'management/routes.html',
                requiredRole: 'dispatcher',
                icon: '../../assets/Icons/map-icon.svg',
                terms: 'rutas recorridos itinerarios paradas',
            },
            {
                title: 'Gestionar destinos',
                section: 'Gestión',
                detail: 'Plantillas de centros y direcciones',
                href: 'management/destinations.html',
                requiredRole: 'dispatcher',
                icon: '../../assets/Icons/location-icon.svg',
                terms: 'destinos centros hospitales sanatorios policlinicas direcciones'
            },
            {
                title: 'Gestionar personal',
                section: 'Gestión',
                detail: 'Choferes y copilotos',
                href: 'management/personnel.html',
                requiredRole: 'dispatcher',
                icon: '../../assets/Icons/person-icon.svg',
                terms: 'personal choferes conductores copilotos registrar conductor agregar personal'
            },
            {
                title: 'Nuevo traslado',
                section: 'Ambulancias',
                detail: 'Abrir formulario de traslado',
                href: 'traces/trace-new.html',
                icon: '../../assets/Icons/location-icon.svg',
                terms: 'crear traslado registrar traslado cargar traslado'
            },
            {
                title: 'Ver documentos',
                section: 'Documentos',
                detail: 'Explorar documentos',
                href: 'documents/documents.html',
                icon: '../../assets/Icons/folder-icon.svg',
                terms: 'buscar documentos lista documentos archivos'
            },
            {
                title: 'Ver traslados',
                section: 'Ambulancias',
                detail: 'Explorar traslados',
                href: 'traces/trace.html',
                icon: '../../assets/Icons/location-icon.svg',
                terms: 'seguimiento trazabilidad ambulancias vehiculos vehículos'
            },
            {
                title: 'Gestión de datos',
                section: 'Gestión',
                detail: 'Pacientes, ambulancias y personal',
                href: 'management/management.html',
                icon: '../../assets/Icons/database-cog.svg',
                terms: 'administracion administrar pacientes vehiculos medicos'
            },
            {
                title: 'Configuración',
                section: 'Cuenta',
                detail: 'Perfil y preferencias',
                href: 'settings.html',
                icon: '../../assets/Icons/settings-icon.svg',
                terms: 'ajustes perfil cuenta contraseña tema'
            },
            {
                title: 'Reportes',
                section: 'Análisis',
                detail: 'Sección en desarrollo',
                icon: '../../assets/Icons/analytics-icon.svg',
                terms: 'analitica estadísticas informes'
            },
            {
                title: 'Calendario',
                section: 'Agenda',
                detail: 'Sección en desarrollo',
                icon: '../../assets/Icons/calendar-icon.svg',
                terms: 'eventos citas agenda fechas'
            },
            {
                title: 'Inicio',
                section: 'Principal',
                detail: 'Volver al menú principal',
                href: 'main-menu.html',
                icon: '../../assets/Icons/house-icon.svg',
                terms: 'menu principal página principal home'
            }
        ];
        const quickDestinations = [destinations[0], destinations[4], destinations[7], destinations[8]];
        let activeIndex = -1;
        let quickResultsTimer;

        const normalize = value => value.toLowerCase().normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/[^a-z0-9]+/g, ' ')
            .trim();

        function matchingDestinations(query) {
            const allowed = item => !item.requiredRole || window.HospitalAuth?.current?.user.roles.includes(item.requiredRole);
            if (!query) return quickDestinations.filter(allowed);
            const words = normalize(query).split(' ').filter(Boolean);
            return destinations
                .filter(allowed)
                .filter(item => {
                    const indexedWords = normalize(`${item.title} ${item.section} ${item.terms}`).split(' ');
                    return words.every(word => indexedWords.some(indexed => indexed.startsWith(word)));
                })
                .sort((a, b) => {
                    const rank = item => {
                        const title = normalize(item.title);
                        const aliases = normalize(item.terms);
                        return (item.href ? 0 : 10) +
                            (title.startsWith(normalize(query)) ? 0 : aliases.includes(normalize(query)) ? 1 : 2);
                    };
                    return rank(a) - rank(b);
                });
        }

        function setActive(index) {
            const links = [...searchList.querySelectorAll('a.search-result')];
            activeIndex = index;
            searchList.querySelectorAll('[role="option"]').forEach(option => {
                option.classList.remove('is-active');
                option.setAttribute('aria-selected', 'false');
            });
            searchInput.removeAttribute('aria-activedescendant');
            if (links[index]) {
                links[index].classList.add('is-active');
                links[index].setAttribute('aria-selected', 'true');
                searchInput.setAttribute('aria-activedescendant', links[index].id);
                links[index].scrollIntoView({ block: 'nearest' });
            }
        }

        function renderResults() {
            const query = normalize(searchInput.value);
            const matches = matchingDestinations(query);
            searchTitle.textContent = query ? 'Resultados' : 'Accesos rápidos';
            searchList.replaceChildren();
            activeIndex = -1;
            searchInput.removeAttribute('aria-activedescendant');

            if (!matches.length) {
                const empty = document.createElement('li');
                empty.className = 'search-empty';
                empty.textContent = 'No encontramos una acción con ese nombre.';
                searchList.append(empty);
            }

            matches.forEach((item, index) => {
                const row = document.createElement('li');
                row.setAttribute('role', 'none');
                const option = document.createElement(item.href ? 'a' : 'div');
                option.className = `search-result${item.href ? '' : ' is-unavailable'}`;
                option.id = `search-option-${index}`;
                option.setAttribute('role', 'option');
                option.setAttribute('aria-selected', 'false');
                if (item.href) option.href = new URL(item.href, viewsBase).href;
                else option.setAttribute('aria-disabled', 'true');

                const icon = document.createElement('span');
                icon.className = 'search-result-icon';
                const image = document.createElement('img');
                image.src = new URL(item.icon, viewsBase).href;
                image.alt = '';
                icon.append(image);

                const copy = document.createElement('span');
                copy.className = 'search-result-copy';
                const title = document.createElement('strong');
                title.textContent = item.title;
                const detail = document.createElement('small');
                detail.textContent = `${item.section} · ${item.detail}`;
                copy.append(title, detail);

                const end = document.createElement('span');
                end.className = 'search-result-end';
                end.textContent = item.href ? '↗' : 'Próximamente';
                option.append(icon, copy, end);
                row.append(option);
                searchList.append(row);
            });

            searchStatus.textContent = query
                ? `${matches.length} ${matches.length === 1 ? 'resultado' : 'resultados'}`
                : 'Accesos rápidos disponibles';
            return matches.length;
        }

        function showResults() {
            const matchCount = renderResults();
            const showPanel = !localSearchType || !normalize(searchInput.value) || matchCount > 0;
            searchPanel.hidden = !showPanel;
            searchInput.setAttribute('aria-expanded', String(showPanel));
            if (!showPanel) searchStatus.textContent = '';
        }

        function scheduleQuickResults() {
            clearTimeout(quickResultsTimer);
            searchPanel.hidden = true;
            searchList.replaceChildren();
            searchInput.setAttribute('aria-expanded', 'false');
            searchInput.removeAttribute('aria-activedescendant');
            searchStatus.textContent = '';
            activeIndex = -1;
            quickResultsTimer = setTimeout(() => {
                if (topbar.classList.contains('search-active') && !normalize(searchInput.value)) {
                    showResults();
                }
            }, 2000);
        }

        function openSearch() {
            topbar.classList.add('search-active');
            topbar.closest('.settings-header')?.classList.add('search-active');
            searchInput.tabIndex = 0;
            searchBtn.setAttribute('aria-expanded', 'true');
            searchBtn.setAttribute('aria-label', 'Cerrar búsqueda');
            scheduleQuickResults();
            searchInput.focus();
        }

        function closeSearch() {
            clearTimeout(quickResultsTimer);
            topbar.classList.remove('search-active');
            topbar.closest('.settings-header')?.classList.remove('search-active');
            searchPanel.hidden = true;
            if (document.activeElement === searchInput) searchInput.blur();
            const hadQuery = searchInput.value !== '';
            searchInput.value = '';
            if (hadQuery) searchInput.dispatchEvent(new Event('input', { bubbles: true }));
            searchInput.tabIndex = -1;
            searchInput.setAttribute('aria-expanded', 'false');
            searchInput.removeAttribute('aria-activedescendant');
            searchBtn.setAttribute('aria-expanded', 'false');
            searchBtn.setAttribute('aria-label', 'Abrir búsqueda');
            activeIndex = -1;
        }

        searchBtn.addEventListener('click', () => {
            if (topbar.classList.contains('search-active')) closeSearch();
            else openSearch();
        });

        searchInput.addEventListener('input', () => {
            if (!topbar.classList.contains('search-active')) return;
            clearTimeout(quickResultsTimer);
            if (normalize(searchInput.value)) showResults();
            else scheduleQuickResults();
        });
        searchInput.addEventListener('keydown', event => {
            if (event.key === 'Escape') {
                event.preventDefault();
                closeSearch();
                searchBtn.focus();
            } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                if (searchPanel.hidden) return;
                event.preventDefault();
                const links = searchList.querySelectorAll('a.search-result');
                if (!links.length) return;
                const direction = event.key === 'ArrowDown' ? 1 : -1;
                setActive(activeIndex === -1
                    ? (direction === 1 ? 0 : links.length - 1)
                    : (activeIndex + direction + links.length) % links.length);
            } else if (event.key === 'Enter') {
                if (searchPanel.hidden) return;
                const links = searchList.querySelectorAll('a.search-result');
                const target = links[activeIndex] || links[0];
                if (target) {
                    event.preventDefault();
                    window.location.assign(target.href);
                }
            }
        });
    });
})();
