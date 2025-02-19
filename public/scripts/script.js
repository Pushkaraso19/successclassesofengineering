function showToast(message, isError = false) {
    var toastContainer = document.getElementById('toast-container');
    var toast = document.createElement('div');
    toast.className = `toast ${isError ? 'error' : 'success'}`;
    toast.innerText = message;
    toastContainer.appendChild(toast);
    toast.style.display = 'block';
    setTimeout(function() {
        toast.style.display = 'none';
        toastContainer.removeChild(toast);
    }, 3000);
}

function deleteBatch(batchId) {
    if (confirm('Are you sure you want to delete this batch?')) {
        const form = document.createElement('form');
        form.method = 'POST';
        form.action = `/admin/batches/${batchId}/delete?_method=DELETE`;

        document.body.appendChild(form);
        form.submit();
    }
}

function deleteAcademicYear(yearId) {
    if (confirm('Are you sure you want to delete this academic year?')) {
        const form = document.createElement('form');
        form.method = 'POST';
        form.action = `/admin/academic-years/${yearId}/delete?_method=DELETE`;

        document.body.appendChild(form);
        form.submit();
    }
}

function deleteStudent(studentId) {
    if (confirm('Are you sure you want to delete this student?')) {
        const form = document.createElement('form');
        form.method = 'POST';
        form.action = `/students/${studentId}/delete?_method=DELETE`;

        document.body.appendChild(form);
        form.submit();
    }
}

function editBatch(batchId) {
    document.getElementById(`batch-name-${batchId}`).readOnly = false;
    document.querySelector(`button[onclick="editBatch(${batchId})"]`).style.display = 'none';
    document.querySelector(`button[onclick="saveBatch(${batchId})"]`).style.display = 'inline-block';
}

function saveBatch(batchId) {
    const batchName = document.getElementById(`batch-name-${batchId}`).value;
    const form = document.createElement('form');
    form.method = 'POST';
    form.action = `/admin/batches/${batchId}/edit`;

    const input = document.createElement('input');
    input.type = 'hidden';
    input.name = 'batch_name';
    input.value = batchName;
    form.appendChild(input);

    document.body.appendChild(form);
    form.submit();
}

function editYear(yearId) {
    document.getElementById(`year-${yearId}`).readOnly = false;
    document.querySelector(`button[onclick="editYear(${yearId})"]`).style.display = 'none';
    document.querySelector(`button[onclick="saveYear(${yearId})"]`).style.display = 'inline-block';
}

function saveYear(yearId) {
    const year = document.getElementById(`year-${yearId}`).value;
    const form = document.createElement('form');
    form.method = 'POST';
    form.action = `/admin/academic-years/${yearId}/edit`;

    const input = document.createElement('input');
    input.type = 'hidden';
    input.name = 'year';
    input.value = year;
    form.appendChild(input);

    document.body.appendChild(form);
    form.submit();
}

function sortTable(columnIndex) {
    var table = document.getElementById("studentsTable");
    var rows = Array.from(table.rows).slice(1);
    var isAscending = table.getAttribute("data-sort-order") === "asc";
    var direction = isAscending ? 1 : -1;

    rows.sort(function(rowA, rowB) {
        var cellA = rowA.cells[columnIndex].innerText;
        var cellB = rowB.cells[columnIndex].innerText;

        if (!isNaN(cellA) && !isNaN(cellB)) {
            return direction * (parseFloat(cellA) - parseFloat(cellB));
        } else {
            return direction * cellA.localeCompare(cellB);
        }
    });

    rows.forEach(function(row) {
        table.tBodies[0].appendChild(row);
    });

    table.setAttribute("data-sort-order", isAscending ? "desc" : "asc");

    var headers = table.querySelectorAll("th");
    headers.forEach(function(header, index) {
        header.classList.remove("asc", "desc");
        if (index === columnIndex) {
            header.classList.add(isAscending ? "desc" : "asc");
        }
    });
}

if (document.getElementById("studentsTable")) {
    sortTable(0);
}

function calculateRemainingFees() {
    const closingAmount = parseInt(document.getElementById('closing-amount').value) || 0;
    const feesPaid = parseInt(document.getElementById('fees-paid').value) || 0;
    const feesPendingInput = document.getElementById('fees-pending');

    if (feesPaid > closingAmount) {
        showToast('Fees paid cannot be greater than closing amount', true);
        document.getElementById('fees-paid').value = closingAmount;
        feesPendingInput.value = 0;
    } else {
        feesPendingInput.value = closingAmount - feesPaid;
    }
}

function exportToExcel() {
    const table = document.getElementById('studentsTable');
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Students');
    
    const headerRow = table.querySelector('thead tr');
    const headers = Array.from(headerRow.cells).map(cell => cell.textContent);
    
    const excludeColumns = ['Edit', 'Call Done'];
    const filteredHeaders = headers.filter(header => !excludeColumns.includes(header));
    const columnIndexes = headers.reduce((acc, header, index) => {
        if (!excludeColumns.includes(header)) {
            acc[header] = index;
        }
        return acc;
    }, {});
    
    worksheet.addRow(filteredHeaders);
    
    const rows = Array.from(table.querySelectorAll('tbody tr'));
    
    rows.forEach(row => {
        const rowData = [];
        filteredHeaders.forEach(header => {
            const cellIndex = columnIndexes[header];
            const cell = row.cells[cellIndex];
            let value = cell.textContent.trim();
            
            if (header === 'Contact') {
                worksheet.getColumn(filteredHeaders.indexOf('Contact') + 1).numFmt = '@';
            }
            
            rowData.push(value);
        });
        worksheet.addRow(rowData);
    });
    
    worksheet.columns.forEach(column => {
        column.width = Math.max(
            filteredHeaders[column.number - 1].length + 2,
            ...rows.map(row => {
                const cell = row.cells[columnIndexes[filteredHeaders[column.number - 1]]];
                return cell ? cell.textContent.length + 2 : 0;
            })
        );
    });
    
    workbook.xlsx.writeBuffer()
        .then(buffer => {
            const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
            const url = window.URL.createObjectURL(blob);
            const anchor = document.createElement('a');
            anchor.href = url;
            anchor.download = 'students_list.xlsx';
            anchor.click();
            window.URL.revokeObjectURL(url);
        })
        .catch(error => console.error('Export failed:', error));
}

function setCookie(name, value, days) {
    let expires = "";
    if (days) {
        const date = new Date();
        date.setTime(date.getTime() + (days * 24 * 60 * 60 * 1000)); 
        expires = "; expires=" + date.toUTCString();
    }
    document.cookie = name + "=" + value + expires + "; path=/";
}


function getCookie(name) {
    let cookies = document.cookie.split("; ");
    for (let i = 0; i < cookies.length; i++) {
        let cookie = cookies[i].split("=");
        if (cookie[0] === name) return cookie[1];
    }
    return null;
}

function saveCallDone(checkbox) {
    const studentId = checkbox.dataset.studentId;
    const callType = checkbox.dataset.callType || "general"; 
    const isChecked = checkbox.checked ? "true" : "false";

    setCookie(`call_done_${callType}_${studentId}`, isChecked, 1); 
}
document.addEventListener('DOMContentLoaded', function () {
    console.log("DOM fully loaded and parsed");
    const urlParams = new URLSearchParams(window.location.search);
    const successMessage = urlParams.get('success');
    const errorMessage = urlParams.get('error');
    const academicYearSelect = document.getElementById('academic-year');
    const batchSelect = document.getElementById('batch');
    const actualAmountInput = document.getElementById('actual-amount');
    const exportBtn = document.getElementById('export-btn');
    const passwordToggleButtons = document.querySelectorAll('.password-toggle');
    const closingAmountInput = document.getElementById('closing-amount');
    const feesPaidInput = document.getElementById('fees-paid');
    const feesPendingInput = document.getElementById('fees-pending');
    const studentForm = document.querySelector('form[action="/students/add"]');
    console.log(studentForm);
    if (successMessage) {
        showToast(decodeURIComponent(successMessage));
        const newUrl = window.location.pathname + window.location.hash;
        window.history.replaceState({}, '', newUrl);
    }

    if (errorMessage) {
        showToast(decodeURIComponent(errorMessage), true);
        const newUrl = window.location.pathname + window.location.hash;
        window.history.replaceState({}, '', newUrl);
    }
    passwordToggleButtons.forEach(button => {
        button.addEventListener('click', function () {
            const passwordInput = this.previousElementSibling;
            const eyeIcon = this.querySelector('.eye-icon');

            if (passwordInput.type === 'password') {
                passwordInput.type = 'text';
                eyeIcon.innerHTML = `
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M1 12C2.5 9 6 4 12 4C18 4 21.5 9 23 12C21.5 15 18 20 12 20C6 20 2.5 15 1 12Z" stroke="black" stroke-width="2" fill="none"/>
                        <circle cx="12" cy="12" r="3" stroke="black" stroke-width="2"/>
                    </svg>
                `;
            } else {
                passwordInput.type = 'password';
                eyeIcon.innerHTML = `
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M1 12C2.5 9 6 4 12 4C18 4 21.5 9 23 12C21.5 15 18 20 12 20C6 20 2.5 15 1 12Z" stroke="black" stroke-width="2" fill="none"/>
                        <path d="M4 4L20 20" stroke="black" stroke-width="2" stroke-linecap="round"/>
                    </svg>
                `;
            }
            
        });
    });

    var today = new Date().toISOString().split('T')[0];
    if (document.getElementById('last-payment-date')) {
        document.getElementById('last-payment-date').setAttribute('max', today);
    }

    [closingAmountInput, feesPaidInput, actualAmountInput, feesPendingInput].forEach(input => {
        if (input) {
            input.addEventListener('input', function() {
                this.value = this.value.replace(/[^0-9]/g, '');
            });
        }
    });

    if (closingAmountInput) {
        closingAmountInput.addEventListener('input', calculateRemainingFees);
    }

    if (feesPaidInput) {
        feesPaidInput.addEventListener('input', calculateRemainingFees);
    }

    async function fetchActualAmount() {
        const academicYearId = academicYearSelect.value;
        const batchId = batchSelect.value;

        if (academicYearId) {
            try {
                const response = await fetch(`/get-actualamount?academic_year_id=${academicYearId}&batch_id=${batchId}`);
                const data = await response.json();
                const amount = parseInt(data.actual_amount) || 0;
                actualAmountInput.value = amount;
                closingAmountInput.value = amount;
                calculateRemainingFees();
            } catch (error) {
                console.error('Error fetching actual amount:', error);
                showToast('Error fetching actual amount', true);
            }
        }
    }

    if (studentForm) {
        studentForm.addEventListener('submit', function(e) {
            e.preventDefault();
            
            const formData = new FormData(this);
            const actualAmount = parseInt(document.getElementById('actual-amount').value) || 0;
            
            formData.append('actual_amount', actualAmount);

            fetch('/students/add', {
                method: 'POST',
                body: formData
            })
            .then(response => response.json())
            .then(data => {
                if (data.success) {
                    window.location.href = '/addStudent?success=' + encodeURIComponent('Student added successfully');
                } else {
                    throw new Error(data.message || 'Failed to add student');
                }
            })
            .catch(error => {
                showToast(error.message, true);
            });
        });
    }
    
    if(academicYearSelect) {
        academicYearSelect.addEventListener('change', fetchActualAmount)
    } else {
        console.warn("Element #academic-year not found");
    }

    if(batchSelect) {
        batchSelect.addEventListener('change', fetchActualAmount);
    } else {
        console.warn("Element #batch not found");
    }

    if (exportBtn) {
        exportBtn.addEventListener('click', exportToExcel);
    } else {
        console.warn("Element #export-btn not found");
    }

    document.querySelectorAll('input[name="call_done"]').forEach(checkbox => {
        const studentId = checkbox.dataset.studentId;
        const callType = checkbox.dataset.callType || "general";  
        const savedState = getCookie(`call_done_${callType}_${studentId}`);
        
        if (savedState === "true") {
            checkbox.checked = true;
        } else if (savedState === "false") {
            checkbox.checked = false;
        }
    });
});