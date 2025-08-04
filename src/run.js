$(function() {
    // --- TAB SWITCHING ---
    $('.tab').click(function() {
      const target = $(this).data('target');
      // activate tab button
      $('.tab').removeClass('active');
      $(this).addClass('active');
      // show matching pane
      $('.tab-content').removeClass('active');
      $(target).addClass('active');
    });
  
    // --- CREATE LINK FORM ---
    $('#create-form').submit(async function(e) {
      e.preventDefault();
      const apiKey      = $('#create-api-key').val().trim();
      const url         = $('#create-url').val().trim();
      const expiration  = $('#create-expiration').val().trim();
      const slug        = $('#create-slug').val().trim();
      const password    = $('#create-password').val().trim();
  
      try {
        const res = await $.ajax({
          url: '/api/create',
          method: 'POST',
          headers: { 'Authorization': 'Bearer ' + apiKey },
          contentType: 'application/json',
          data: JSON.stringify({ url, expiration, slug, password })
        });
        $('#create-result').text(JSON.stringify(res, null, 2));
      } catch (err) {
        $('#create-result').text('Error: ' + (err.responseJSON?.error || err.statusText));
      }
    });
  
    // --- LOAD & DISPLAY LINKS ---
    async function loadLinks() {
      const apiKey     = $('#manage-api-key').val().trim();
      const superKey   = $('#manage-super-secret').val().trim();
      const $tbody     = $('#links-table tbody');
      $tbody.empty();
      $('#manage-info').text('Loading…');
  
      try {
        const links = await $.ajax({
          url: '/api/links',
          method: 'GET',
          headers: {
            'Authorization': 'Bearer ' + apiKey,
            'X-Super-Secret': superKey
          }
        });
  
        if (!links.length) {
          $('#manage-info').text('No links found.');
          return;
        }
  
        // Populate table
        links.forEach(link => {
          const created = new Date(link.metadata.createdAt)
                            .toLocaleString();
          const expires = new Date(link.metadata.expiresAtUtc)
                            .toLocaleString();
  
          $tbody.append(`
            <tr>
              <td>${link.slug}</td>
              <td><a href="${link.url}" target="_blank">${link.url}</a></td>
              <td>${link.passwordProtected ? 'Private' : 'Public'}</td>
              <td>${created}</td>
              <td>${expires}</td>
              <td>
                <button class="btn delete" data-slug="${link.slug}">
                  🗑️
                </button>
              </td>
            </tr>
          `);
        });
  
        $('#manage-info').text('Loaded ' + links.length + ' link(s).');
  
      } catch (err) {
        $('#manage-info').text('Error loading links: ' +
          (err.responseJSON?.error || err.statusText));
      }
    }
  
    // hook “Load My Links” button
    $('#load-links').click(loadLinks);
  
    // delegate Delete button clicks
    $('#links-table').on('click', '.btn.delete', async function() {
      const slug    = $(this).data('slug');
      const apiKey  = $('#manage-api-key').val().trim();
      const superKey= $('#manage-super-secret').val().trim();
  
      if (!confirm(`Delete link “${slug}”?`)) return;
  
      try {
        await $.ajax({
          url: '/api/links/' + slug,
          method: 'DELETE',
          headers: {
            'Authorization': 'Bearer ' + apiKey,
            'X-Super-Secret': superKey
          }
        });
        loadLinks();  // refresh
      } catch (err) {
        alert('Delete failed: ' + (err.responseJSON?.error || err.statusText));
      }
    });
  });
  