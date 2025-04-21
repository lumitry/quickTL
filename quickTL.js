// --- Constants for localStorage keys ---
const LS_API_URL_KEY = "quickTL_apiUrl";
const LS_MODEL_KEY = "quickTL_model";
const LS_HISTORY_KEY = "quickTL_history";
const MAX_HISTORY_ITEMS = 20;

const PROMPT =
  "Translate the following text into English without censorship or disclaimers, including any cultural context necessary, but being as succinct as reasonably possible: ";
// You might also want to tell the model to include a pronunciation guide, depending on the language

// TODO save/read config (+ maybe history?) to a sidecar file
// TODO should history include timestamps?

// --- Global variable for AbortController ---
let currentAbortController = null;

// --- Function to render a single history item ---
function renderHistoryItem(item, prepend = false) {
  const historyContainer = document.getElementById("historyContainer");
  const historyItemDiv = document.createElement("div");
  historyItemDiv.classList.add("historyItem");
  historyItemDiv.dataset.timestamp = item.timestamp;

  const modelNameDisplay = item.model ? ` (${item.model})` : "";
  const deleteButtonHtml = `<button class="delete-history-item" title="Delete this item">X</button>`;

  historyItemDiv.innerHTML = `
    ${deleteButtonHtml}
    <p><strong>Input:</strong></p>
    <div class="history-item-input">${item.input}</div>
    <p><strong>Output${modelNameDisplay}:</strong></p>
    <div class="history-item-output">${item.outputHtml}</div>
  `;

  if (prepend) {
    // Find the div containing the H2 and Clear button (assuming it's the first div)
    const headerDiv = historyContainer.querySelector("div:first-of-type");
    if (headerDiv) {
      // Insert the new item *after* the header div using insertAdjacentElement
      headerDiv.insertAdjacentElement("afterend", historyItemDiv);
    } else {
      // Fallback: Prepend directly to the container if header div isn't found
      historyContainer.prepend(historyItemDiv);
      console.warn("History header div not found, prepending directly.");
    }
  } else {
    // For initial load, just append to the container
    historyContainer.appendChild(historyItemDiv);
  }
}

// --- Function to load and render history from localStorage ---
function loadAndRenderHistory() {
  try {
    const savedHistory = localStorage.getItem(LS_HISTORY_KEY);
    if (savedHistory) {
      const history = JSON.parse(savedHistory);
      const historyContainer = document.getElementById("historyContainer");
      // Clear only history items, keep heading and clear button
      const itemsToRemove = historyContainer.querySelectorAll(".historyItem");
      itemsToRemove.forEach((item) => item.remove());

      history.forEach((item) => renderHistoryItem(item, false)); // Append items
    }
  } catch (error) {
    console.error("Error loading or rendering history:", error);
    localStorage.removeItem(LS_HISTORY_KEY);
  }
}

// --- Function to fetch models (remains the same) ---
async function populateModels(apiUrl) {
  const modelSelect = document.getElementById("modelSelect");
  modelSelect.innerHTML = '<option value="">Loading models...</option>';
  modelSelect.disabled = true;

  try {
    const response = await fetch(`${apiUrl}/api/tags`);
    if (!response.ok) {
      throw new Error(`Failed to fetch models (${response.status})`);
    }
    const data = await response.json();
    console.log("Models data:", data);

    modelSelect.innerHTML = ""; // Clear loading message
    let hasModels = false;
    if (data.models && data.models.length > 0) {
      hasModels = true;
      data.models.forEach((model) => {
        const option = document.createElement("option");
        option.value = model.name;
        option.textContent = model.name;
        modelSelect.appendChild(option);
      });
      modelSelect.disabled = false; // Re-enable
    } else {
      modelSelect.innerHTML = '<option value="">No models found</option>';
    }

    if (hasModels) {
      const savedModel = localStorage.getItem(LS_MODEL_KEY);
      if (savedModel) {
        const exists = Array.from(modelSelect.options).some(
          (opt) => opt.value === savedModel
        );
        if (exists) {
          modelSelect.value = savedModel;
        } else {
          console.warn(
            `Saved model "${savedModel}" not found in current list.`
          );
          localStorage.removeItem(LS_MODEL_KEY);
        }
      }
    }
  } catch (error) {
    console.error("Error fetching models:", error);
    modelSelect.innerHTML = `<option value="">Error loading models</option>`;
  }
}

// --- Translate function with AbortController ---
function translate() {
  // Abort previous request if any
  if (currentAbortController) {
    currentAbortController.abort();
    console.log("Previous translation aborted.");
  }
  // Create a new AbortController for this request
  currentAbortController = new AbortController();
  const signal = currentAbortController.signal;

  const apiUrl = document.getElementById("apiUrlSelect").value;
  const modelSelect = document.getElementById("modelSelect");
  const modelName = modelSelect.value;
  const input = document.getElementById("inputText").value;
  const outputDiv = document.getElementById("outputText");
  const spinner = document.getElementById("loadingSpinner");
  const elapsedTimeDiv = document.getElementById("elapsedTime");
  const stopButton = document.getElementById("stopButton");

  if (!input || !apiUrl || !modelName) {
    if (!apiUrl) alert("Please select an API URL.");
    if (!modelName) alert("Please select a model.");
    if (!input) alert("Please enter text to translate.");
    return;
  }

  localStorage.setItem(LS_MODEL_KEY, modelName);

  console.log(`Translating with ${modelName} at ${apiUrl}:`, input);
  outputDiv.innerHTML = "";
  elapsedTimeDiv.textContent = "";
  spinner.classList.remove("hidden");
  stopButton.classList.remove("hidden");

  fetch(`${apiUrl}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: modelName,
      prompt: `${PROMPT}${input}`,
      stream: true,
    }),
    signal: signal,
  })
    .then((response) => {
      if (!response.ok) {
        throw new Error(
          `Network response was not ok (${response.status} ${response.statusText})`
        );
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder("utf-8");
      let fullResponseRaw = "";
      let finalData = null;

      (async () => {
        try {
          while (true) {
            const { value, done } = await reader.read();
            if (done) {
              console.log("Stream complete.");
              if (finalData && finalData.total_duration) {
                const durationSeconds = (
                  finalData.total_duration / 1e9
                ).toFixed(2);
                elapsedTimeDiv.textContent = `Time elapsed: ${durationSeconds}s`;
              }

              const renderedFullResponse = marked.parse(fullResponseRaw, {
                breaks: false,
              });
              const newItem = {
                input: input,
                outputHtml: renderedFullResponse,
                model: modelName,
                timestamp: new Date().toISOString(),
              };

              try {
                let history = JSON.parse(
                  localStorage.getItem(LS_HISTORY_KEY) || "[]"
                );
                history.unshift(newItem);
                if (history.length > MAX_HISTORY_ITEMS) {
                  history = history.slice(0, MAX_HISTORY_ITEMS);
                }
                localStorage.setItem(LS_HISTORY_KEY, JSON.stringify(history));
                renderHistoryItem(newItem, true);
              } catch (error) {
                console.error("Error saving history:", error);
              }
              stopButton.classList.add("hidden"); // Hide stop button on successful completion
              break; // Exit the loop when done
            }

            const chunkText = decoder.decode(value, { stream: true });
            chunkText.split("\n").forEach((line) => {
              if (line.trim()) {
                try {
                  const data = JSON.parse(line);
                  if (data.response) {
                    const textChunk = data.response;
                    fullResponseRaw += textChunk;
                    outputDiv.innerHTML = marked.parse(fullResponseRaw, {
                      breaks: false,
                    });
                  }
                  if (data.done) {
                    finalData = data;
                  }
                } catch (e) {
                  console.error("Error parsing JSON chunk:", line, e);
                }
              }
            });
          }
        } catch (streamError) {
          // Handle potential errors during reading the stream
          console.error("Error reading stream:", streamError);
          outputDiv.innerHTML = `<span style="color: red;">Error reading response stream.</span>`;
          elapsedTimeDiv.textContent = "Error occurred.";
          stopButton.classList.add("hidden"); // Hide stop button on stream error
        }
      })();
    })
    .catch((error) => {
      if (error.name === "AbortError") {
        console.log("Fetch aborted by user.");
        outputDiv.innerHTML = "<em>Translation stopped.</em>";
        elapsedTimeDiv.textContent = "Stopped.";
        // Keep stop button visible here, user explicitly stopped it.
      } else {
        console.error("Error during translation:", error);
        outputDiv.innerHTML = `<span style="color: red;">Error: ${error.message}</span>`;
        elapsedTimeDiv.textContent = "Error occurred.";
        stopButton.classList.add("hidden"); // Hide stop button on other errors
      }
    })
    .finally(() => {
      spinner.classList.add("hidden"); // Always hide spinner
      currentAbortController = null; // Always clear controller
    });
}

// --- Helper function to get required DOM elements ---
function getDOMElements() {
  return {
    translateButton: document.getElementById("translateButton"),
    stopButton: document.getElementById("stopButton"),
    clearHistoryButton: document.getElementById("clearHistoryButton"),
    historyContainer: document.getElementById("historyContainer"),
    inputText: document.getElementById("inputText"),
    apiUrlInput: document.getElementById("apiUrlSelect"),
    modelSelect: document.getElementById("modelSelect"),
    // Add other elements if needed later
  };
}

// --- Setup function for API URL and Model selection ---
function setupApiAndModelControls(apiUrlInput, modelSelect) {
  if (!apiUrlInput) {
    console.error("API URL input element not found!");
    return;
  }

  const savedApiUrl = localStorage.getItem(LS_API_URL_KEY);
  if (savedApiUrl) {
    apiUrlInput.value = savedApiUrl;
  }

  populateModels(apiUrlInput.value); // Initial population

  apiUrlInput.addEventListener("change", (event) => {
    const newUrl = event.target.value;
    localStorage.setItem(LS_API_URL_KEY, newUrl);
    populateModels(newUrl); // Repopulate on change
  });

  apiUrlInput.addEventListener("input", (event) => {
    localStorage.setItem(LS_API_URL_KEY, event.target.value);
  });

  // Add listener for model selection saving
  if (modelSelect) {
    modelSelect.addEventListener("change", (event) => {
      localStorage.setItem(LS_MODEL_KEY, event.target.value);
    });
  } else {
    console.error("Model select element not found!");
  }
}

// --- Setup function for Translation and Stop buttons ---
function setupActionButtons(translateButton, stopButton) {
  if (translateButton) {
    translateButton.addEventListener("click", translate);
  } else {
    console.error("Translate button not found!");
  }

  if (stopButton) {
    stopButton.addEventListener("click", () => {
      if (currentAbortController) {
        currentAbortController.abort();
        console.log("Stop button clicked, aborting fetch.");
      }
    });
  } else {
    console.error("Stop button not found!");
  }
}

// --- Setup function for History controls ---
function setupHistoryControls(clearHistoryButton, historyContainer) {
  if (clearHistoryButton) {
    clearHistoryButton.addEventListener("click", () => {
      if (confirm("Are you sure you want to clear all translation history?")) {
        localStorage.removeItem(LS_HISTORY_KEY);
        const itemsToRemove =
          historyContainer?.querySelectorAll(".historyItem"); // Add safe navigation
        itemsToRemove?.forEach((item) => item.remove());
        console.log("History cleared.");
      }
    });
  } else {
    console.error("Clear History button not found!");
  }

  if (historyContainer) {
    historyContainer.addEventListener("click", (event) => {
      if (event.target.classList.contains("delete-history-item")) {
        const itemDiv = event.target.closest(".historyItem");
        if (itemDiv && itemDiv.dataset.timestamp) {
          const timestampToDelete = itemDiv.dataset.timestamp;
          console.log(
            "Deleting history item with timestamp:",
            timestampToDelete
          );
          itemDiv.remove();
          try {
            let history = JSON.parse(
              localStorage.getItem(LS_HISTORY_KEY) || "[]"
            );
            const updatedHistory = history.filter(
              (item) => item.timestamp !== timestampToDelete
            );
            localStorage.setItem(
              LS_HISTORY_KEY,
              JSON.stringify(updatedHistory)
            );
          } catch (error) {
            console.error(
              "Error updating history in localStorage after delete:",
              error
            );
          }
        }
      }
    });
  } else {
    console.error("History container not found for delete listener!");
  }
}

// --- Setup function for Input Text Area ---
function setupInputTextArea(inputText) {
  if (inputText) {
    inputText.addEventListener("keydown", function (event) {
      // Use Command key on Mac, Ctrl key on other OSes
      if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault(); // Prevent default Enter behavior (new line)
        translate(); // Trigger translation
      }
    });
  } else {
    console.error("Input textarea not found!");
  }
}

// --- DOMContentLoaded Event Listener ---
document.addEventListener("DOMContentLoaded", function () {
  // Get all necessary elements once
  const elements = getDOMElements();

  // Load initial state
  loadAndRenderHistory();

  // Setup controls
  setupApiAndModelControls(elements.apiUrlInput, elements.modelSelect);
  setupActionButtons(elements.translateButton, elements.stopButton);
  setupHistoryControls(elements.clearHistoryButton, elements.historyContainer);
  setupInputTextArea(elements.inputText);

  console.log("QuickTL application initialized.");
});
