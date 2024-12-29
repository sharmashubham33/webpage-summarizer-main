document.addEventListener('DOMContentLoaded', function() {
  const apiKeyForm = document.getElementById('apiKeyForm');
  const summaryDiv = document.getElementById('summary');
  const apiKeyInput = document.getElementById('apiKey');
  const saveKeyBtn = document.getElementById('saveKey');
  const getSummaryBtn = document.getElementById('getSummary');
  const summaryText = document.getElementById('summaryText');

  // Check if API key exists
  chrome.storage.local.get(['geminiApiKey'], function(result) {
    if (result.geminiApiKey) {
      apiKeyForm.style.display = 'none';
      summaryDiv.style.display = 'block';
      
      // Load saved summary for current URL if it exists
      getCurrentTabUrl().then(url => {
        chrome.storage.local.get([url], function(result) {
          if (result[url]) {
            displayFormattedSummary(result[url]);
          }
        });
      });
    }
  });

  async function getCurrentTabUrl() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab.url;
  }

  function displayFormattedSummary(summary) {
    // Clean up the text by removing extra asterisks
    let cleanSummary = summary.replace(/\*\*/g, '');
    
    // Split the summary into sections
    const sections = cleanSummary.split(/(?=TLDR:|Key Takeaways:|Detailed Summary:)/g);
    
    let formattedHtml = '<div class="summary-container">';
    
    sections.forEach(section => {
      if (section.includes('TLDR:')) {
        formattedHtml += `
          <div class="summary-section">
            <h3>TLDR</h3>
            <p>${section.replace('TLDR:', '').trim()}</p>
          </div>`;
      } else if (section.includes('Key Takeaways:')) {
        // Convert dash/asterisk points into proper bullet points
        let takeaways = section.replace('Key Takeaways:', '').trim();
        let points = takeaways.split(/[•*-]\s+/).filter(point => point.trim());
        
        formattedHtml += `
          <div class="summary-section">
            <h3>Key Takeaways</h3>
            <ul class="bullet-points">
              ${points.map(point => `<li>${point.trim()}</li>`).join('')}
            </ul>
          </div>`;
      } else if (section.includes('Detailed Summary:')) {
        formattedHtml += `
          <div class="summary-section">
            <h3>Detailed Summary</h3>
            <p>${section.replace('Detailed Summary:', '').trim()}</p>
          </div>`;
      }
    });
    
    formattedHtml += '</div>';
    summaryText.innerHTML = formattedHtml;
  }

  // Save API key
  saveKeyBtn.addEventListener('click', function() {
    const apiKey = apiKeyInput.value.trim();
    if (apiKey) {
      chrome.storage.local.set({ geminiApiKey: apiKey }, function() {
        apiKeyForm.style.display = 'none';
        summaryDiv.style.display = 'block';
      });
    }
  });

  // Get summary
  getSummaryBtn.addEventListener('click', async function() {
    summaryText.innerHTML = '<div class="loading">Analyzing page content...</div>';
    
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const url = tab.url;
      
      // Check if we already have a summary for this URL
      const savedSummary = await chrome.storage.local.get([url]);
      if (savedSummary[url]) {
        displayFormattedSummary(savedSummary[url]);
        return;
      }

      // Get the API key
      const result = await chrome.storage.local.get(['geminiApiKey']);
      const apiKey = result.geminiApiKey;

      if (!apiKey) {
        throw new Error('API key not found');
      }

      // Inject content script to get page content
      const [{ result: pageContent }] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        function: () => {
          const article = document.querySelector('article') || document.querySelector('main') || document.body;
          return article.innerText.slice(0, 30000);
        }
      });

      const prompt = `Analyze the following text and provide a structured summary in this exact format:

TLDR:
[2-3 sentences that capture the core message]

Key Takeaways:
• [First key point]
• [Second key point]
• [Third key point]
• [Fourth key point]
• [Fifth key point]

Detailed Summary:
[2-3 paragraphs with comprehensive analysis]

Text to analyze:
${pageContent}`;

      const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=${apiKey}`;

      const requestBody = {
        contents: [{
          parts: [{ text: prompt }]
        }],
        generationConfig: {
          temperature: 0.7,
          topK: 40,
          topP: 0.95,
          maxOutputTokens: 1024,
        },
      };

      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestBody)
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(`API Error: ${response.status} - ${JSON.stringify(errorData)}`);
      }

      const data = await response.json();
      const summary = data.candidates[0].content.parts[0].text;
      
      // Save summary for this URL
      await chrome.storage.local.set({ [url]: summary });
      
      // Display the formatted summary
      displayFormattedSummary(summary);

    } catch (error) {
      console.error('Full error:', error);
      summaryText.innerHTML = `<div class="error-message">Error: ${error.message}</div>`;
    }
  });
});