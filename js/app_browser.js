let eventSource;
let isStopped = false;
let db;
let table_data = [];
let totalRecords = 0;
let uniqueRecords = 0;
let duplicateRecords = 0;



function initializeIndexedDB() {
    return new Promise((resolve, reject) => {
        const dbRequest = indexedDB.open("UniqueRecordsDB", 1);

        dbRequest.onupgradeneeded = (event) => {
            db = event.target.result;
            if (!db.objectStoreNames.contains("records")) {
                db.createObjectStore("records", { keyPath: "uniqueKey" });
            }
        };

        dbRequest.onsuccess = (event) => {
            db = event.target.result;
            const transaction = db.transaction("records", "readwrite");
            const store = transaction.objectStore("records");

            // Clear previous data
            store.clear().onsuccess = () => {
                console.log("Previous IndexedDB data cleared.");
                resolve();
            };

            transaction.onerror = (error) => {
                console.error("Error clearing IndexedDB:", error);
                reject(error);
            };
        };

        dbRequest.onerror = (event) => {
            console.error("Error initializing IndexedDB:", event.target.error);
            reject(event.target.error);
        };
    });
}

// Add record to IndexedDB
function addRecordToIndexedDB(record, onSuccess, onDuplicate) {
    if (!db) {
        console.error("IndexedDB is not initialized!");
        return;
    }
    const transaction = db.transaction("records", "readwrite");
    const store = transaction.objectStore("records");

    const getRequest = store.get(record.uniqueKey);
    totalRecords++;

    getRequest.onsuccess = () => {
        if (!getRequest.result) {
            const addRequest = store.add(record);
            addRequest.onsuccess = onSuccess;
            uniqueRecords++;
        } else {
            onDuplicate();
            duplicateRecords++;
        }
        updateRecordNumbers(totalRecords, uniqueRecords, duplicateRecords);
    };

    getRequest.onerror = () => {
        console.error("Error accessing IndexedDB.");
    };
}
function updateRecordNumbers(totalRecords, uniqueRecords, duplicateRecords) {
    $('#total').text(totalRecords);
    $('#unique').text(uniqueRecords);
    $('#duplicate').text(duplicateRecords);
}
document.getElementById("startButton").addEventListener("click", () => {
    $("#startButton").css("display", "none");
    $("#stopButton").css("display", "block");
    $("#downloadCsvButton").css("display", "none");

    const tableBody = document.querySelector("#dataTable tbody");
    initializeIndexedDB();
    // Prevent starting if already running
    if (eventSource && !isStopped) return;

    console.log("Starting data fetch...");
    isStopped = false;
    tableBody.innerHTML = "";

    // Replace with your actual API endpoint
    eventSource = new EventSource(`http://localhost:5003/demand_base`);

    eventSource.onmessage = (event) => {
        if (event.data === "[Loading]") {
            showLoadingModal("Loading...");
            return;
        }

        if (event.data === "[loadingURL]") {
            showLoadingModal("Loading URL...");
            return;
        }

        if (event.data === "[DONE]") {
            eventSource.close();
            $("#stopButton").click();
            return;
        }

        if (event.data === "[ERROR]") {
            showServerError();
            eventSource.close();
            $("#stopButton").click();
            return;
        }

        hideLoadingModal();

        // Parse the row data
        const rowData = JSON.parse(event.data);

        // Add record to IndexedDB for deduplication
        addRecordToIndexedDB(
            rowData,
            () => {
                // Success: Record is unique, add to table
                addRowToTable(rowData, tableBody);
                showToast(`Added: Name: ${rowData.name}, Email: ${rowData.email}, Phone: ${rowData.phone}, Address: ${rowData.address}`);
            },
            () => {
                // Duplicate record found
                showErrorToast(`Duplicate entry: Name: ${rowData.name}, Email: ${rowData.email}, Phone: ${rowData.phone}, Address: ${rowData.address}`);
            }
        );
    };

    eventSource.onerror = (error) => {
        console.error("Error receiving data:", error);
        showServerError();
        eventSource.close();
    };
});

function showLoadingModal(message) {
    $("#loadingMessage").text(message);
    const loadingModal = new bootstrap.Modal(document.getElementById("loadingModal"));
    loadingModal.show();
}

function hideLoadingModal() {
    $("#closeLoadingbtn").click();
}

function showServerError() {
    $(".server_error").css("display", "block");
}

function addRowToTable(rowData, tableBody) {
    const newRow = document.createElement("tr");
    newRow.innerHTML = `
        <td>${rowData.name}</td>
        <td>${rowData.email}</td>
        <td>${rowData.phone}</td>
        <td>${rowData.address}</td>`;
    tableBody.appendChild(newRow);
}

function showToast(message) {
    document.getElementById("toastContent").innerText = message;
    const infoToast = new bootstrap.Toast(document.getElementById("infoToast"));
    infoToast.show();
}

function showErrorToast(message) {
    document.getElementById("errorToastContent").innerText = message;
    const errorToast = new bootstrap.Toast(document.getElementById("errorToast"));
    errorToast.show();
}

////////
window.addEventListener("beforeunload", () => {
    if (eventSource) {
        eventSource.close();
    }
});

document.getElementById('loadButton').addEventListener('click', async () => {
    $("#loadButton").css('display', 'none');
    $("#startButton").css('display', 'block');
    $("#stopButton").css('display', 'none');
    $("#downloadCsvButton").css('display', 'none');
    await fetch('http://localhost:5003/loadurl', { method: 'GET' });
    console.log("Open browser.");
});

document.getElementById('stopButton').addEventListener('click', async () => {
    $("#startButton").css('display', 'none');
    $("#stopButton").css('display', 'none');
    $("#downloadCsvButton").css('display', 'block');

    if (eventSource) {
        isStopped = true;
        eventSource.close();
        eventSource = null;
        await fetch('http://localhost:5003/stop_scraping', { method: 'GET' });
        console.log("Scraping stopped by the user.");
    }
});

document.getElementById('downloadCsvButton').addEventListener('click', (event) => {
    $("#stopButton").click();
    event.preventDefault();
    const table = document.querySelector("#dataTable");
    const rows = table.querySelectorAll('tr');
    const csvData = [];

    // Loop through all rows and cells to extract data
    rows.forEach((row, index) => {
        const rowData = [];
        const cells = row.querySelectorAll('td, th');

        cells.forEach(cell => {
            let cellText = cell.innerText.trim();

            // Escape double quotes by doubling them
            if (cellText.includes('"')) {
                cellText = cellText.replace(/"/g, '""');
            }

            // Enclose the cell value in double quotes if it contains a comma, a quote, or a newline
            if (cellText.includes(',') || cellText.includes('"') || cellText.includes('\n')) {
                cellText = `"${cellText}"`;
            }

            rowData.push(cellText);
        });

        if (rowData.length > 0) {
            csvData.push(rowData.join(','));
        }
    });

    // Create a CSV string
    const csvString = csvData.join('\n');

    // Create a Blob with the CSV data and trigger a download
    const blob = new Blob([csvString], { type: 'text/csv' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'DemandBase.csv';
    link.click();
});