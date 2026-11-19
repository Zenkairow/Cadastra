$docxPath = "c:\Users\ayush\OneDrive\Desktop\Land-registry\docs\IEEE_Research_Paper_Final.docx"
$pdfPath = "c:\Users\ayush\OneDrive\Desktop\Land-registry\docs\IEEE_Research_Paper_Final.pdf"

Write-Host "Opening Microsoft Word..."
$word = New-Object -ComObject Word.Application
$word.Visible = $false
try {
    $doc = $word.Documents.Open($docxPath)
    Write-Host "Exporting to PDF: $pdfPath"
    $doc.ExportAsFixedFormat($pdfPath, 17) # 17 = wdExportFormatPDF
    $doc.Close([ref]$false)
    Write-Host "Successfully generated PDF via Microsoft Word!"
}
catch {
    Write-Error $_
}
finally {
    $word.Quit()
    [System.Runtime.InteropServices.Marshal]::ReleaseComObject($word) | Out-Null
    [System.GC]::Collect()
    [System.GC]::WaitForPendingFinalizers()
}
