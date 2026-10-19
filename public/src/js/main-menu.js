document.addEventListener('DOMContentLoaded', () => {

    const profileWrapper = document.querySelector('.profile-wrapper');
    const profileBtn = document.querySelector('.profile-button');

    if (profileWrapper && profileBtn) {
        profileBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            profileWrapper.classList.toggle('profile-active');
            profileBtn.setAttribute('aria-expanded', String(profileWrapper.classList.contains('profile-active')));
        });

        document.addEventListener('click', (e) => {
            if (!profileWrapper.contains(e.target)) {
                profileWrapper.classList.remove('profile-active');
                profileBtn.setAttribute('aria-expanded', 'false');
            }
        });
    }

    const appShell = document.querySelector('.app-shell');
    const menuBtn = document.querySelector('.sidebar-action');
    const navItems = document.querySelectorAll('.nav-item');
    const sidebarNav = document.querySelector('.sidebar-nav');
    const indicator = document.querySelector('.nav-indicator');

    function updateIndicator(item) {
        if (!indicator || !sidebarNav || !item) return;
        const topPos = item.offsetTop;
        sidebarNav.style.setProperty('--indicator-top', `${topPos}px`);
    }

    if (menuBtn && appShell) {
        menuBtn.addEventListener('click', () => {
            appShell.classList.toggle('menu-open');
            menuBtn.setAttribute('aria-expanded', String(appShell.classList.contains('menu-open')));
        });
    }

    // Keep indicator aligned on window resize
    window.addEventListener('resize', () => {
        const activeItem = document.querySelector('.nav-item.active');
        if (activeItem) updateIndicator(activeItem);
    });

    navItems.forEach(item => {
        item.addEventListener('click', (e) => {
            const href = item.getAttribute('href');

            if (!href || href === '#') e.preventDefault();

            document.querySelector('.nav-item.active')?.classList.remove('active');
            item.classList.add('active');

            // Animates smoothly to the clicked item
            updateIndicator(item);
        });
    });

    // Position immediately on load without animation
    const activeStart = document.querySelector('.nav-item.active');
    if (activeStart) {
        updateIndicator(activeStart);
    }

});
