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

function addRecordToIndexedDB(records_arr, onSuccess, onDuplicate) {
    if (!db) {
        console.error("IndexedDB is not initialized!");
        return;
    }
    const transaction = db.transaction("records", "readwrite");
    const store = transaction.objectStore("records");

    records_arr.forEach(record => {
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
    });

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
    let start_page = $('#start_page').val();

    // Replace with your actual API endpoint
    eventSource = new EventSource(`http://localhost:5003/demand_base?start_page=${start_page}`);

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
        const response = JSON.parse(event.data);
        const page_num = response.page_num;
        const rowsData = response.data;
        addRecordToIndexedDB(
            rowsData,
            () => {
                addRowsToTable(rowsData, tableBody);
                showToast(`${rowsData.length} Rows added successfully`);
            },
            () => {
                showErrorToast(`Duplicate data found`);
            }
        );
    };

    eventSource.onerror = (error) => {
        showErrorToast(`Browser isn't responding please close captch its closed and try agin from page number ${rowsData.page_num}.`);
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

function addRowsToTable(rowsData, tableBody) {
    tableBody.innerHTML = "";
    rowsData.forEach(rowData => {
        const newRow = document.createElement("tr");
        newRow.innerHTML = `
        <td>${rowData.name}</td>
        <td>${rowData.email}</td>
        <td>${rowData.phone}</td>
        <td>${rowData.address}</td>`;
        tableBody.appendChild(newRow);
    });
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
    // $("#stopButton").click();
    event.preventDefault();
    const table = document.querySelector("#dataTable");
    const rows = table.querySelectorAll('tr');
    const csvData = [];

    rows.forEach((row, index) => {
        const rowData = [];
        const cells = row.querySelectorAll('td, th');

        cells.forEach(cell => {
            let cellText = cell.innerText.trim();

            if (cellText.includes('"')) {
                cellText = cellText.replace(/"/g, '""');
            }
            if (cellText.includes(',') || cellText.includes('"') || cellText.includes('\n')) {
                cellText = `"${cellText}"`;
            }

            rowData.push(cellText);
        });

        if (rowData.length > 0) {
            csvData.push(rowData.join(','));
        }
    });
    const csvString = csvData.join('\n');

    const blob = new Blob([csvString], { type: 'text/csv' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'DemandBase.csv';
    link.click();
});