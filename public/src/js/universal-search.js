(() => {
    const scriptUrl = document.currentScript.src;
    const viewsBase = new URL('../views/', scriptUrl);

    document.addEventListener('DOMContentLoaded', async () => {
    await window.HospitalI18n.ready;
    await window.HospitalAuth.ready;

        const searchBtn = document.querySelector('.search-action');
        const topbar = searchBtn?.closest('.topbar, .settings-search-host');
        const searchInput = topbar?.querySelector('.search-input');
        const searchWrapper = topbar?.querySelector('.search-wrapper');
        if (!searchBtn || !topbar || !searchInput || !searchWrapper) return;

        topbar.classList.add('quick-search-topbar');
        searchWrapper.setAttribute('role', 'search');
        searchInput.type = 'text';
        if (!searchInput.id) searchInput.id = 'quick-search';
        const localSearchType = document.getElementById('documentsGrid') ? 'documents' : null;
        window.HospitalI18n.bindAttr(searchInput, "placeholder", () => window.HospitalI18n.t("main_menu.buscar_una_accion_o_seccion"));
        window.HospitalI18n.bindAttr(searchInput, "aria-label", () => window.HospitalI18n.t("main_menu.buscar_una_accion_o_seccion_2"));
        searchInput.setAttribute('role', 'combobox');
        searchInput.setAttribute('aria-autocomplete', 'list');
        searchInput.setAttribute('aria-controls', 'search-results-list');
        searchInput.setAttribute('aria-expanded', 'false');
        searchInput.setAttribute('autocomplete', 'off');
        searchInput.tabIndex = -1;
        window.HospitalI18n.bindAttr(searchBtn, "aria-label", () => window.HospitalI18n.t("main_menu.abrir_busqueda"));
        searchBtn.setAttribute('aria-controls', searchInput.id);
        searchBtn.setAttribute('aria-expanded', 'false');

        let searchPanel = topbar.querySelector('.search-results');
        if (!searchPanel) {
            searchPanel = document.createElement('div');
            searchPanel.className = 'search-results';
            searchPanel.id = 'search-results';
            searchPanel.hidden = true;
            window.HospitalI18n.setHTML(searchPanel, `<div class="search-results-heading"><span id="search-results-title">${window.HospitalI18n.mark("main_menu.accesos_rapidos")}</span></div>` +
                `<ul id="search-results-list" class="search-results-list" role="listbox" aria-label="${window.HospitalI18n.html("main_menu.resultados_de_busqueda")}" data-i18n-aria-label="main_menu.resultados_de_busqueda"></ul>` +
                `<p class="search-results-footer">${window.HospitalI18n.mark("main_menu.haz_clic_en_una_opcion_disponible_para_ir_a_esa_seccion")}</p>`);
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
            window.HospitalI18n.bindText(searchPanel.querySelector('.search-results-footer'), () => window.HospitalI18n.t('universal_search.haz_clic_en_una_opcion_para_ir_a_esa_seccion_usa_la_busqueda_de_la_lista_para_filtrar_docu'));
        }

        const destinations = [
            {
                get title() { return window.HospitalI18n.t("universal_search.cargar_documento"); },
                get section() { return window.HospitalI18n.t("main_menu.documentos"); },
                get detail() { return window.HospitalI18n.t("universal_search.abrir_formulario_de_carga"); },
                href: 'documents/documents-upload.html',
                icon: '../../assets/Icons/folder-icon.svg',
                get terms() { return window.HospitalI18n.t("universal_search.subir_documento_cargar_archivo_adjuntar_archivo_nuevo_documento"); }
            },
            {
                get title() { return window.HospitalI18n.t("universal_search.gestionar_pacientes"); },
                get section() { return window.HospitalI18n.t("trace_map.gestion"); },
                get detail() { return window.HospitalI18n.t("universal_search.abrir_la_seccion_de_pacientes"); },
                href: 'management/patients.html',
                requiredRole: 'records_manager',
                icon: '../../assets/Icons/database-cog.svg',
                get terms() { return window.HospitalI18n.t("universal_search.cargar_paciente_registrar_paciente_agregar_paciente_nuevo_paciente"); }
            },
            {
                get title() { return window.HospitalI18n.t("universal_search.gestionar_medicos"); },
                get section() { return window.HospitalI18n.t("trace_map.gestion"); },
                get detail() { return window.HospitalI18n.t("universal_search.equipo_medico_y_especialidades"); },
                href: 'management/doctors.html',
                requiredRole: 'records_manager',
                icon: '../../assets/Icons/doctor-icon.svg',
                get terms() { return window.HospitalI18n.t("universal_search.doctores_medicos_medicos_especialistas_registrar_agregar_nuevo_medico_doctor"); }
            },
            {
                get title() { return window.HospitalI18n.t("universal_search.gestionar_ambulancias"); },
                get section() { return window.HospitalI18n.t("trace_map.gestion"); },
                get detail() { return window.HospitalI18n.t("universal_search.abrir_la_seccion_de_ambulancias"); },
                href: 'management/ambulances.html',
                requiredRole: 'dispatcher',
                icon: '../../assets/Icons/ambulance-icon.png',
                get terms() { return window.HospitalI18n.t("universal_search.cargar_vehiculo_cargar_vehiculo_registrar_ambulancia_agregar_vehiculo_transporte"); }
            },
            {
                get title() { return window.HospitalI18n.t("survey.crear_encuesta"); },
                get section() { return window.HospitalI18n.t("main_menu.encuestas"); },
                get detail() { return window.HospitalI18n.t("universal_search.crear_un_borrador_de_encuesta"); },
                href: 'surveys/survey-new.html',
                icon: '../../assets/Icons/survey-icon.svg',
                get terms() { return window.HospitalI18n.t("universal_search.crear_encuesta_nueva_encuesta_subir_encuesta"); }
            },
            {
                get title() { return window.HospitalI18n.t("universal_search.gestionar_cuentas"); },
                get section() { return window.HospitalI18n.t("trace_map.gestion"); }, get detail() { return window.HospitalI18n.t("universal_search.aprobacion_y_permisos_del_personal"); }, href: 'management/accounts.html', requiredRole: 'admin', icon: '../../assets/Icons/person-icon.svg', terms: window.HospitalI18n.t("shared.cuentas_usuarios_aprobar_permisos_roles"),
            },
            {
                get title() { return window.HospitalI18n.t("universal_search.gestionar_rutas"); },
                get section() { return window.HospitalI18n.t("trace_map.gestion"); },
                get detail() { return window.HospitalI18n.t("universal_search.recorridos_opcionales_para_traslados"); },
                href: 'management/routes.html',
                requiredRole: 'dispatcher',
                icon: '../../assets/Icons/map-icon.svg',
                get terms() { return window.HospitalI18n.t("universal_search.rutas_recorridos_itinerarios_paradas"); },
            },
            {
                get title() { return window.HospitalI18n.t("universal_search.gestionar_destinos"); },
                get section() { return window.HospitalI18n.t("trace_map.gestion"); },
                get detail() { return window.HospitalI18n.t("universal_search.plantillas_de_centros_y_direcciones"); },
                href: 'management/destinations.html',
                requiredRole: 'dispatcher',
                icon: '../../assets/Icons/location-icon.svg',
                get terms() { return window.HospitalI18n.t("universal_search.destinos_centros_hospitales_sanatorios_policlinicas_direcciones"); }
            },
            {
                get title() { return window.HospitalI18n.t("universal_search.gestionar_personal"); },
                get section() { return window.HospitalI18n.t("trace_map.gestion"); },
                get detail() { return window.HospitalI18n.t("universal_search.choferes_y_copilotos"); },
                href: 'management/personnel.html',
                requiredRole: 'dispatcher',
                icon: '../../assets/Icons/person-icon.svg',
                get terms() { return window.HospitalI18n.t("universal_search.personal_choferes_conductores_copilotos_registrar_conductor_agregar_personal"); }
            },
            {
                get title() { return window.HospitalI18n.t("universal_search.nuevo_traslado"); },
                get section() { return window.HospitalI18n.t("main_menu.ambulancias"); },
                get detail() { return window.HospitalI18n.t("universal_search.abrir_formulario_de_traslado"); },
                href: 'traces/trace-new.html',
                requiredRole: 'dispatcher',
                icon: '../../assets/Icons/location-icon.svg',
                get terms() { return window.HospitalI18n.t("universal_search.crear_traslado_registrar_traslado_cargar_traslado"); }
            },
            {
                get title() { return window.HospitalI18n.t("universal_search.ver_documentos"); },
                get section() { return window.HospitalI18n.t("main_menu.documentos"); },
                get detail() { return window.HospitalI18n.t("universal_search.explorar_documentos"); },
                href: 'documents/documents.html',
                icon: '../../assets/Icons/folder-icon.svg',
                get terms() { return window.HospitalI18n.t("universal_search.buscar_documentos_lista_documentos_archivos"); }
            },
            {
                get title() { return window.HospitalI18n.t("trace_map.ver_traslados"); },
                get section() { return window.HospitalI18n.t("main_menu.ambulancias"); },
                get detail() { return window.HospitalI18n.t("universal_search.explorar_traslados"); },
                href: 'traces/trace.html',
                icon: '../../assets/Icons/location-icon.svg',
                get terms() { return window.HospitalI18n.t("universal_search.seguimiento_trazabilidad_ambulancias_vehiculos_vehiculos"); }
            },
            {
                get title() { return window.HospitalI18n.t("management.gestion_de_datos"); },
                get section() { return window.HospitalI18n.t("trace_map.gestion"); },
                get detail() { return window.HospitalI18n.t("universal_search.pacientes_ambulancias_y_personal"); },
                href: 'management/management.html',
                requiredRoles: ['admin', 'records_manager', 'dispatcher'],
                icon: '../../assets/Icons/database-cog.svg',
                get terms() { return window.HospitalI18n.t("universal_search.administracion_administrar_pacientes_vehiculos_medicos"); }
            },
            {
                get title() { return window.HospitalI18n.t("main_menu.configuracion"); },
                section: window.HospitalI18n.t("shared.cuenta"),
                get detail() { return window.HospitalI18n.t("universal_search.perfil_y_preferencias"); },
                href: 'settings.html',
                icon: '../../assets/Icons/settings-icon.svg',
                get terms() { return window.HospitalI18n.t("universal_search.ajustes_perfil_cuenta_contrasena_tema"); }
            },
            {
                title: window.HospitalI18n.t("shared.reportes"),
                get section() { return window.HospitalI18n.t("universal_search.analisis"); },
                get detail() { return window.HospitalI18n.t("universal_search.seccion_en_desarrollo"); },
                icon: '../../assets/Icons/analytics-icon.svg',
                get terms() { return window.HospitalI18n.t("universal_search.analitica_estadisticas_informes"); }
            },
            {
                title: window.HospitalI18n.t("shared.calendario"),
                section: window.HospitalI18n.t("shared.agenda"),
                get detail() { return window.HospitalI18n.t("universal_search.seccion_en_desarrollo"); },
                icon: '../../assets/Icons/calendar-icon.svg',
                get terms() { return window.HospitalI18n.t("universal_search.eventos_citas_agenda_fechas"); }
            },
            {
                get title() { return window.HospitalI18n.t("main_menu.inicio"); },
                section: window.HospitalI18n.t("shared.principal"),
                get detail() { return window.HospitalI18n.t("universal_search.volver_al_menu_principal"); },
                href: 'main-menu.html',
                icon: '../../assets/Icons/house-icon.svg',
                get terms() { return window.HospitalI18n.t("universal_search.menu_principal_pagina_principal_home"); }
            }
        ];
        const quickDestinations = [destinations[0], destinations[4], destinations[7], destinations[8]];
        let activeIndex = -1;
        let quickResultsTimer;

        const normalize = value => value.toLowerCase().normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/[^a-z0-9]+/g, ' ')
            .trim();

        function allowed(item) {
            const roles = window.HospitalAuth?.current?.user?.roles;
            return Boolean(roles) && (!item.requiredRole || roles.includes(item.requiredRole)) &&
                (!item.requiredRoles || item.requiredRoles.some(role => roles.includes(role)));
        }

        function matchingDestinations(query) {
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
            window.HospitalI18n.bindText(searchTitle, () => query ? window.HospitalI18n.t("shared.resultados") : window.HospitalI18n.t("main_menu.accesos_rapidos"));
            searchList.replaceChildren();
            activeIndex = -1;
            searchInput.removeAttribute('aria-activedescendant');

            if (!matches.length) {
                const empty = document.createElement('li');
                empty.className = 'search-empty';
                window.HospitalI18n.bindText(empty, () => window.HospitalI18n.t("universal_search.no_encontramos_una_accion_con_ese_nombre"));
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
                if (item.href) {
                    option.href = new URL(item.href, viewsBase).href;
                    option.addEventListener('click', event => {
                        if (!allowed(item)) { event.preventDefault(); showResults(); }
                    });
                }
                else option.setAttribute('aria-disabled', 'true');

                const icon = document.createElement('span');
                icon.className = 'search-result-icon';
                const image = document.createElement('img');
                image.src = new URL(item.icon, viewsBase).href;
                window.HospitalI18n.bindAttr(image, "alt", () => '');
                icon.append(image);

                const copy = document.createElement('span');
                copy.className = 'search-result-copy';
                const title = document.createElement('strong');
                window.HospitalI18n.bindText(title, () => item.title);
                const detail = document.createElement('small');
                window.HospitalI18n.bindText(detail, () => `${item.section} · ${item.detail}`);
                copy.append(title, detail);

                const end = document.createElement('span');
                end.className = 'search-result-end';
                window.HospitalI18n.bindText(end, () => item.href ? '↗' : window.HospitalI18n.t("universal_search.proximamente"));
                option.append(icon, copy, end);
                row.append(option);
                searchList.append(row);
            });

            window.HospitalI18n.bindText(searchStatus, () => query
                ? window.HospitalI18n.t('universal_search.result_count',{count:matches.length})
                : window.HospitalI18n.t("universal_search.accesos_rapidos_disponibles"));
            return matches.length;
        }

        function showResults() {
            const matchCount = renderResults();
            const showPanel = !localSearchType || !normalize(searchInput.value) || matchCount > 0;
            searchPanel.hidden = !showPanel;
            searchInput.setAttribute('aria-expanded', String(showPanel));
            if (!showPanel) window.HospitalI18n.bindText(searchStatus, () => '');
        }

        function scheduleQuickResults() {
            clearTimeout(quickResultsTimer);
            searchPanel.hidden = true;
            searchList.replaceChildren();
            searchInput.setAttribute('aria-expanded', 'false');
            searchInput.removeAttribute('aria-activedescendant');
            window.HospitalI18n.bindText(searchStatus, () => '');
            activeIndex = -1;
            quickResultsTimer = setTimeout(() => {
                if (topbar.classList.contains('search-active') && !normalize(searchInput.value)) {
                    showResults();
                }
            }, 2000);
        }

        window.addEventListener('hospital:session', () => {
            if (topbar.classList.contains('search-active') && !searchPanel.hidden) showResults();
        });

        function openSearch() {
            topbar.classList.add('search-active');
            topbar.closest('.settings-header')?.classList.add('search-active');
            searchInput.tabIndex = 0;
            searchBtn.setAttribute('aria-expanded', 'true');
            window.HospitalI18n.bindAttr(searchBtn, "aria-label", () => window.HospitalI18n.t("universal_search.cerrar_busqueda"));
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
            window.HospitalI18n.bindAttr(searchBtn, "aria-label", () => window.HospitalI18n.t("main_menu.abrir_busqueda"));
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
                    target.click();
                }
            }
        });
    });
})();
